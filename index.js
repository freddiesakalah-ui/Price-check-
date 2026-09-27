const express = require('express');
const Airtable = require('airtable');

const app = express();
app.use(express.json());

// Initialize Airtable using environment variables set on Render
const base = new Airtable({ apiKey: process.env.AIRTABLE_ACCESS_TOKEN }).base(process.env.AIRTABLE_BASE_ID);

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Webhook server is running! 🚀');
});

// Main Dialogflow CX Webhook Route
app.post('/webhook', async (req, res) => {
  const sessionParameters = req.body.sessionInfo?.parameters || {};
  
  // Extract all parameters including Flavour and Unit
  const product = (sessionParameters.product || '').trim();
  const city = (sessionParameters.city || '').trim();
  const subLocation = (sessionParameters.sub_location || '').trim();
  const brand = (sessionParameters.brand || '').trim();
  const flavour = (sessionParameters.flavour || sessionParameters.flavor || '').trim();
  const unit = (sessionParameters.unit || '').trim();

  // Retrieve existing cart/history from session parameters or initialize an empty array
  let cart = Array.isArray(sessionParameters.cart) ? sessionParameters.cart : [];

  try {
    // Build formulas using ARRAYJOIN to cleanly compare lookup values
    let formulaConditions = [
      `FIND(LOWER("${product}"), LOWER(ARRAYJOIN({Product}, ",")))`,
      `FIND(LOWER("${city}"), LOWER(ARRAYJOIN({city}, ",")))`,
      `{Availability} = 'In Stock'`,
      `{Outdated Flag} = 'NO'`
    ];

    if (subLocation) {
      formulaConditions.push(`FIND(LOWER("${subLocation}"), LOWER(ARRAYJOIN({sub_location}, ",")))`);
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

    // Fetch matching price records sorted by price ascending
    const records = await base('Prices').select({
      filterByFormula: formula,
      sort: [{ field: 'Price USD', direction: 'asc' }]
    }).firstPage();

    let responseText = "";
    
    // Construct full product label (e.g., "1L Lobels Orange Crush Mazoe")
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
        
        // Extract shop name cleanly from lookup field or primary link field
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

        // Fetch Formatted_Timestamp field from Airtable
        const timestamp = record.get('Formatted_Timestamp') || '';
        const timeDisplay = timestamp ? ` _(Updated: ${timestamp})_` : '';

        responseText += `${medal} **${shopName}:** $${price.toFixed(2)}${index === 0 ? ' (Cheapest! 🎉)' : ''}${timeDisplay}\n`;

        // Store the cheapest record (index === 0) into the session history
        if (index === 0) {
          const cartItem = {
            item: fullProductTitle,
            shop: shopName,
            price: price,
            timestamp: timestamp
          };

          const existingIndex = cart.findIndex(c => c.item.toLowerCase() === fullProductTitle.toLowerCase());
          if (existingIndex > -1) {
            cart[existingIndex] = cartItem; // Update existing entry
          } else {
            cart.push(cartItem); // Append new entry
          }
        }
      });
      responseText += `\n`;
    }

    // --- SUB-SESSION SUMMARY TABLE & RUNNING TOTAL ---
    if (cart.length > 0) {
      responseText += `----------------------------------------\n`;
      responseText += `🛒 **Your Saved Search Basket:**\n`;
      
      let totalBudgetCost = 0;

      cart.forEach((savedItem, index) => {
        totalBudgetCost += savedItem.price;
        const timeInfo = savedItem.timestamp ? ` _[${savedItem.timestamp}]_` : '';
        responseText += `${index + 1}. ${savedItem.item} - **${savedItem.shop}**: $${savedItem.price.toFixed(2)}${timeInfo}\n`;
      });

      responseText += `\n💰 **TOTAL BUDGET COST:** **$${totalBudgetCost.toFixed(2)}**\n`;
      responseText += `----------------------------------------\n\n`;
    }

    // Call-to-action prompt
    responseText += `💬 *Would you like to check another item or end here?*\n`;
    responseText += `• Type a new item (e.g., *"Sugar"*)\n`;
    responseText += `• Type *"Exit"* or *"Done"* to finish`;

    // Return fulfillment response and persist updated cart in session parameters
    res.status(200).json({
      fulfillmentResponse: {
        messages: [{ text: { text: [responseText] } }]
      },
      sessionInfo: {
        parameters: {
          cart: cart
        }
      }
    });

  } catch (error) {
    console.error("Webhook Execution Error:", error);
    res.status(200).json({
      fulfillmentResponse: {
        messages: [{ text: { text: ["⚠️ System error while fetching prices. Please try again later."] } }]
      }
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
           
      
      
            
           
                

   
