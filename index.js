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
  const product = sessionParameters.product || '';
  const city = sessionParameters.city || '';
  const subLocation = sessionParameters.sub_location || '';
  const brand = sessionParameters.brand || '';

  try {
    // 1. Mandatory base conditions matching your Airtable column names & constraints
    let formulaConditions = [
      `FIND(LOWER("${product}"), LOWER(ARRAYJOIN({Product}, "")))`,
      `FIND(LOWER("${city}"), LOWER(ARRAYJOIN({Location}, "")))`,
      `{Availability} = 'In Stock'`,
      `{Outdated Flag} = 'NO'`
    ];

    // 2. Add sub-location filter if user provided it
    if (subLocation) {
      formulaConditions.push(`FIND(LOWER("${subLocation}"), LOWER(ARRAYJOIN({Location}, "")))`);
    }

    // 3. Add brand filter if user provided it (and it's not 'any')
    if (brand && brand.toLowerCase() !== 'any') {
      formulaConditions.push(`FIND(LOWER("${brand}"), LOWER(ARRAYJOIN({Product}, "")))`);
    }

    const formula = `AND(${formulaConditions.join(', ')})`;

    // Query Airtable Prices table sorted by price ascending
    const records = await base('Prices').select({
      filterByFormula: formula,
      sort: [{ field: 'Price USD', direction: 'asc' }]
    }).firstPage();

    let responseText = "";

    if (!records || records.length === 0) {
      const brandPrefix = (brand && brand.toLowerCase() !== 'any') ? `${brand} ` : '';
      const locationLabel = subLocation ? `${subLocation}, ${city}` : city;
      responseText = `❌ Sorry, no live in-stock prices found for **${brandPrefix}${product}** in ${locationLabel}.`;
    } else {
      const locationLabel = subLocation ? `${subLocation}, ${city}` : city;
      const brandTitle = (brand && brand.toLowerCase() !== 'any') ? `${brand} ` : '';
      responseText = `📊 **Price Comparison: ${brandTitle}${product}**\n📍 *${locationLabel}*\n\n`;
      const medals = ['🥇', '🥈', '🥉'];

      records.forEach((record, index) => {
        const medal = medals[index] || '🔹';
        const rawShop = record.get('Shop');
        const shop = Array.isArray(rawShop) ? rawShop[0] : (rawShop || 'Store');
        const price = record.get('Price USD') || 0;

        responseText += `${medal} **${shop}:** $${Number(price).toFixed(2)}${index === 0 ? ' (Cheapest! 🎉)' : ''}\n`;
      });
    }

    // Send formatted message back to Dialogflow CX
    res.status(200).json({
      fulfillmentResponse: {
        messages: [{ text: { text: [responseText] } }]
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

