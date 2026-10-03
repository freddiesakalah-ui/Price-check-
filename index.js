const express = require('express');
const Airtable = require('airtable');

const app = express();
app.use(express.json());

// Initialize Airtable using environment variables
const base = new Airtable({ apiKey: process.env.AIRTABLE_ACCESS_TOKEN }).base(process.env.AIRTABLE_BASE_ID);

// Google Maps API Key for Geocoding
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'YOUR_GOOGLE_MAPS_API_KEY_HERE';

// Health check endpoint
app.get('/', (req, res) => {
    res.send('Webhook server is running! 🚀');
});

// Main Dialogflow CX Webhook Route
app.post('/webhook', async (req, res) => {
    const body = req.body;
    const tag = body.fulfillmentInfo?.tag;
    const sessionParameters = body.sessionInfo?.parameters || {};

    // =========================================================================
    // FEATURE 1: Google Maps Reverse Geocoding (tag: "reverseGeocode")
    // =========================================================================
    if (tag === 'reverseGeocode') {
        const lat = sessionParameters.lat;
        const lng = sessionParameters.lng;

        if (!lat || !lng) {
            return res.status(200).json({
                sessionInfo: { parameters: { ...sessionParameters } }
            });
        }

        try {
            const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`;
            const apiRes = await fetch(geocodeUrl);
            const apiData = await apiRes.json();
            const results = apiData.results;

            let city = '';
            let subLocation = '';

            if (results && results.length > 0) {
                for (const component of results[0].address_components) {
                    if (component.types.includes('sublocality') || component.types.includes('neighborhood')) {
                        subLocation = component.long_name;
                    }
                    if (component.types.includes('locality')) {
                        city = component.long_name;
                    }
                }
            }

            return res.status(200).json({
                sessionInfo: {
                    parameters: {
                        ...sessionParameters,
                        city: city || sessionParameters.city || '',
                        sub_location: subLocation || sessionParameters.sub_location || sessionParameters.sublocation || ''
                    }
                },
                fulfillment_response: {
                    messages: [
                        {
                            text: {
                                text: [`📍 Location detected: ${subLocation ? subLocation + ', ' : ''}${city}`]
                            }
                        }
                    ]
                }
            });
        } catch (error) {
            console.error('Reverse Geocoding Error:', error.message);
            return res.status(200).json({
                sessionInfo: { parameters: { ...sessionParameters } }
            });
        }
    }

    // =========================================================================
    // FEATURE 2: Airtable Price Search & Basket Management (Default Search)
    // =========================================================================
    
    // Extract all parameters from Dialogflow CX session
    const product = (sessionParameters.product || '').trim();
    const city = (sessionParameters.city || '').trim();
    const subLocation = (sessionParameters.sub_location || sessionParameters.sublocation || '').trim();
    const brand = (sessionParameters.brand || '').trim();
    const flavour = (sessionParameters.flavour || sessionParameters.flavor || '').trim();
    const unit = (sessionParameters.unit || '').trim();

    // Retrieve existing cart/history from session parameters or initialize an empty array
    let cart = Array.isArray(sessionParameters.cart) ? sessionParameters.cart : [];

    try {
        let formulaConditions = [
            `FIND(LOWER("${product}"), LOWER(ARRAYJOIN({Product}, ",")))`,
            `FIND(LOWER("${city}"), LOWER(ARRAYJOIN({City}, ",")))`,
            `{Availability} = 'In Stock'`,
            `{Outdated Flag} = 'NO'`
        ];

        if (subLocation) {
            formulaConditions.push(`FIND(LOWER("${subLocation}"), LOWER(ARRAYJOIN({Sub_Location}, ",")))`);
        }

        if (brand && brand.toLowerCase() !== 'any') {
            formulaConditions.push(`FIND(LOWER("${brand}"), LOWER(ARRAYJOIN({Brand}, ",")))`);
        }

        if (flavour && flavour.toLowerCase() !== 'any') {
            formulaConditions.push(`FIND(LOWER("${flavour}"), LOWER(ARRAYJOIN({Flavour}, ",")))`);
        }

        if (unit && unit.toLowerCase() !== 'any') {
            formulaConditions.push(`FIND(LOWER("${unit}"), LOWER(ARRAYJOIN({Unit}, ",")))`);
        }

        const formula = `AND(${formulaConditions.join(', ')})`;

        const records = await base('Prices').select({
            filterByFormula: formula,
            sort: [{ field: 'Price USD', direction: 'asc' }]
        }).firstPage();

        let responseText = "";

        const unitLabel = (unit && unit.toLowerCase() !== 'any') ? `${unit} ` : '';
        const brandLabel = (brand && brand.toLowerCase() !== 'any') ? `${brand} ` : '';
        const flavourLabel = (flavour && flavour.toLowerCase() !== 'any') ? `${flavour} ` : '';
        const fullProductTitle = `${unitLabel}${brandLabel}${flavourLabel}${product}`.trim();
        const locationLabel = subLocation ? `${subLocation}, ${city}` : city;

        if (!records || records.length === 0) {
            responseText = `❌ Sorry, no live in-stock prices found for **${fullProductTitle}** in ${locationLabel}.\n\n`;
        } else {
            responseText = `📊 **Price Comparison: ${fullProductTitle}**\n📍 *${locationLabel}*\n\n`;
            const medals = ['🥇', '🥈', '🥉'];

            records.forEach((record, index) => {
                const medal = medals[index] || '🔹';

                const shopLookup = record.get('shop_name');
                const rawShop = record.get('Shop');
                let shopName = '';

                if (Array.isArray(shopLookup) && shopLookup.length > 0) {
                    shopName = shopLookup[0];
                } else if (typeof shopLookup === 'string' && shopLookup.trim() !== '') {
                    shopName = shopLookup;
                } else if (Array.isArray(rawShop) && rawShop.length > 0) {
                    shopName = rawShop[0];
                } else if (typeof rawShop === 'string') {
                    shopName = rawShop;
                }

                if (!shopName || shopName.startsWith('rec')) {
                    shopName = 'Store';
                }

                const price = Number(record.get('Price USD') || 0);
                const timestamp = record.get('Formatted_Timestamp') || '';
                const timeDisplay = timestamp ? ` _(Updated: ${timestamp})_` : '';

                responseText += `${medal} **${shopName}**: $${price.toFixed(2)}${index === 0 ? ' (Cheapest! 🥳)' : ''}${timeDisplay}\n`;

                if (index === 0) {
                    const cartItem = {
                        item: fullProductTitle,
                        shop: shopName,
                        price: price,
                        timestamp: timestamp
                    };
                    cart.push(cartItem);
                }
            });
        }

        let totalCost = cart.reduce((sum, entry) => sum + entry.price, 0);

        let cartSummary = "";
        if (cart.length > 0) {
            cartSummary += `\n──────────────────────────────\n🛒 **Your Saved Search Basket:**\n`;
            cart.forEach((c, i) => {
                cartSummary += `  ${i + 1}. ${c.item} - **${c.shop}**: $${c.price.toFixed(2)}${c.timestamp ? ` [${c.timestamp}]` : ''}\n`;
            });
            cartSummary += `\n💰 **TOTAL BUDGET COST: $${totalCost.toFixed(2)}**\n`;
        }

        responseText += `${cartSummary}\n💭 *Would you like to check another item or end here?*\n• Type a new item (e.g., "Sugar")\n• Type "Exit" or "Done" to finish`;

        return res.status(200).json({
            sessionInfo: {
                parameters: {
                    ...sessionParameters,
                    cart: cart
                }
            },
            fulfillment_response: {
                messages: [
                    {
                        text: {
                            text: [responseText]
                        }
                    }
                ]
            }
        });

    } catch (err) {
        console.error('Airtable Query Error:', err);
        return res.status(200).json({
            fulfillment_response: {
                messages: [
                    {
                        text: {
                            text: ["An error occurred while fetching prices. Please try again later."]
                        }
                    }
                ]
            }
        });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Webhook active on port ${PORT}`));
