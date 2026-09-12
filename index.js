const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// Airtable Configuration (Environment Variables)
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY; 
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID; 
const AIRTABLE_TABLE_NAME = 'Prices';

app.post('/webhook', async (req, res) => {
    try {
        // 1. Extract session parameters from Dialogflow CX request body
        const parameters = req.body.sessionInfo?.parameters || {};
        const product = parameters.product || '';
        const unit = parameters.unit || '';
        const city = parameters.city || '';
        const subLocation = parameters.sub_location || '';
        const brand = parameters.brand || 'any';

        // 2. Construct Case-Insensitive Airtable Filter Formula using LOWER()
        // Escapes single quotes to prevent formula syntax errors
        const safeProduct = product.replace(/'/g, "\\'");
        const safeUnit = unit.replace(/'/g, "\\'");
        const safeCity = city.replace(/'/g, "\\'");
        const safeSubLocation = subLocation.replace(/'/g, "\\'");
        const safeBrand = brand.replace(/'/g, "\\'");

        let filterFormula = `AND(` +
            `LOWER({Product}) = LOWER('${safeProduct}'), ` +
            `LOWER({Unit}) = LOWER('${safeUnit}'), ` +
            `LOWER({City}) = LOWER('${safeCity}'), ` +
            `LOWER({Sub_Location}) = LOWER('${safeSubLocation}')` +
        `)`;

        if (safeBrand && safeBrand.toLowerCase() !== 'any') {
            filterFormula = `AND(` +
                `LOWER({Product}) = LOWER('${safeProduct}'), ` +
                `LOWER({Unit}) = LOWER('${safeUnit}'), ` +
                `LOWER({City}) = LOWER('${safeCity}'), ` +
                `LOWER({Sub_Location}) = LOWER('${safeSubLocation}'), ` +
                `LOWER({Brand}) = LOWER('${safeBrand}')` +
            `)`;
        }

        // 3. Query Airtable API (Sorted by lowest price ascending)
        const airtableUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}?filterByFormula=${encodeURIComponent(filterFormula)}&sort[0][field]=Price&sort[0][direction]=asc`;
        
        const airtableResponse = await axios.get(airtableUrl, {
            headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
        });

        const records = airtableResponse.data.records;

        // Variables for final response
        let priceResultsText = "";
        let searchTimestamp = "";

        // 4. Format Price Results and Extract Formatted_Timestamp
        if (records.length === 0) {
            priceResultsText = `❌ Sorry, no live in-stock prices found for **${product} (${unit})** in ${subLocation}, ${city}.`;
            
            // Fallback timestamp if no record is found in Airtable
            searchTimestamp = new Date().toLocaleString("en-GB", { timeZone: "Africa/Harare" }).replace(',', '');
        } else {
            const medals = ['🥇', '🥈', '🥉'];
            
            // Extract formula-based timestamp field from Airtable OR fallback to Node date
            const airtableTime = records[0].fields.Formatted_Timestamp || records[0].fields['Formatted Timestamp'];

            if (airtableTime) {
                searchTimestamp = airtableTime;
            } else {
                searchTimestamp = new Date().toLocaleString("en-GB", { 
                    timeZone: "Africa/Harare",
                    day: "2-digit", 
                    month: "2-digit", 
                    year: "2-digit", 
                    hour: "2-digit", 
                    minute: "2-digit", 
                    second: "2-digit" 
                }).replace(',', '');
            }

            const formattedList = records.map((record, index) => {
                const store = record.fields.Store_Name || 'Local Store';
                const price = record.fields.Price ? `$${record.fields.Price.toFixed(2)}` : 'N/A';
                const prefix = medals[index] || '•';
                const note = index === 0 ? ' (Cheapest! 🎉)' : '';
                return `${prefix} **${store}:** ${price}${note}`;
            }).join('\n');

            priceResultsText = formattedList;
        }

        // 5. Return Payload back to Dialogflow CX
        return res.json({
            sessionInfo: {
                parameters: {
                    price_results_list: priceResultsText,
                    search_timestamp: searchTimestamp
                }
            }
        });

    } catch (error) {
        console.error('Webhook Error:', error.message);
        
        const errorTimestamp = new Date().toLocaleString("en-GB", { timeZone: "Africa/Harare" }).replace(',', '');

        return res.json({
            sessionInfo: {
                parameters: {
                    price_results_list: "⚠️ Unable to retrieve prices at the moment. Please try again later.",
                    search_timestamp: errorTimestamp
                }
            }
        });
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`PriceCheckZim Webhook server running on port ${PORT}`);
});
