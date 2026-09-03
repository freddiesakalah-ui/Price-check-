const express = require('express');
const Airtable = require('airtable');

const app = express();
app.use(express.json());

// Initialize Airtable using environment variables set on Render
const base = new Airtable({ apiKey: process.env.AIRTABLE_ACCESS_TOKEN }).base(process.env.AIRTABLE_BASE_ID);

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Webhook server is running! ??');
});

// Main Dialogflow CX Webhook Route
app.post('/webhook', async (req, res) => {
  const sessionParameters = req.body.sessionInfo?.parameters || {};
  const product = (sessionParameters.product || '').trim();
  const city = (sessionParameters.city || '').trim();
  const subLocation = (sessionParameters.sub_location || '').trim();
  const brand = (sessionParameters.brand || '').trim();

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

    const formula = `AND(${formulaConditions.join(', ')})`;

    // Fetch matching price records sorted by price ascending
    const records = await base('Prices').select({
      filterByFormula: formula,
      sort: [{ field: 'Price USD', direction: 'asc' }]
    }).firstPage();

    let responseText = "";

    if (!records || records.length === 0) {
      const brandPrefix = (brand && brand.toLowerCase() !== 'any') ? `${brand} ` : '';
      const locationLabel = subLocation ? `${subLocation}, ${city}` : city;
      responseText = `? Sorry, no live in-stock prices found for **${brandPrefix}${product}** in ${locationLabel}.\n\n`;
    } else {
      const locationLabel = subLocation ? `${subLocation}, ${city}` : city;
      const brandTitle = (brand && brand.toLowerCase() !== 'any') ? `${brand} ` : '';
      responseText = `?? **Price Comparison: ${brandTitle}${product}**\n?? *${locationLabel}*\n\n`;
      const medals = ['??', '??', '??'];

      records.forEach((record, index) => {
        const medal = medals[index] || '??';
        
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

        // Fallback if no text name could be resolved
        if (!shopName || shopName.startsWith('rec')) {
          shopName = 'Store';
        }

        const price = record.get('Price USD') || 0;

        responseText += `${medal} **${shopName}:** $${Number(price).toFixed(2)}${index === 0 ? ' (Cheapest! ??)' : ''}\n`;
      });
      responseText += `\n`;
    }

    // Call-to-action prompt appended at the bottom
    responseText += `?? *Would you like to check another item or end here?*\n`;
    responseText += `• Type a new item (e.g., *"Sugar"*)\n`;
    responseText += `• Type *"Exit"* or *"Done"* to finish`;

    res.status(200).json({
      fulfillmentResponse: {
        messages: [{ text: { text: [responseText] } }]
      }
    });

  } catch (error) {
    console.error("Webhook Execution Error:", error);
    res.status(200).json({
      fulfillmentResponse: {
        messages: [{ text: { text: ["?? System error while fetching prices. Please try again later."] } }]
      }
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
