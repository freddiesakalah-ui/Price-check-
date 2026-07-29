const express = require("express");
const Airtable = require("airtable");

const app = express();
app.use(express.json());

// Initialize Airtable using environment variables
const base = new Airtable({ apiKey: process.env.AIRTABLE_ACCESS_TOKEN }).base(
  process.env.AIRTABLE_BASE_ID
);

// Health check endpoint for Render
app.get("/", (req, res) => {
  res.send("Webhook server is running! 🚀");
});

// Dialogflow CX Webhook Route
app.post("/webhook", async (req, res) => {
  const sessionParameters = req.body.sessionInfo?.parameters || {};
  const product = sessionParameters.product;
  const city = sessionParameters.city;
  const subLocation = sessionParameters.sub_location;
  const brand = sessionParameters.brand;

  try {
    let conditions = [
  `FIND(LOWER("${product}"), LOWER({Product Name}))`,
  `LOWER({City}) = LOWER("${city}")`,
  `LOWER({Sub-location}) = LOWER("${subLocation}")`
];

if (brand && brand.toLowerCase() !== "any") {
  conditions.push(
    `LOWER({Brand}) = LOWER("${brand}")`
  );
}

const formula = `AND(${conditions.join(",")})`; {
      formula = `AND(${formula}, LOWER({Brand}) = LOWER("${brand}"))`;
    }

    const records = await base("Prices")
      .select({
        filterByFormula: formula,
        sort: [{ field: "Price", direction: "asc" }],
      })
      .firstPage();

    let responseText = "";
    if (!records || records.length === 0) {
      responseText = `❌ No live prices for **${ brand !== "any" ? brand : "" } ${product}** found in ${subLocation}, ${city}.`;
    } else {
      responseText = `📊 **Price Comparison: ${records[0].get( "Brand" )} ${records[0].get("Product Name")}**\n📍 *${subLocation}, ${city}*\n\n`;
      const medals = ["🥇", "🥈", "🥉"];

      records.forEach((record, index) => {
        const medal = medals[index] || "🔹";
        responseText += `${medal} **${record.get("Shop Name")}:** $${Number( record.get("Price") ).toFixed(2)}${index === 0 ? " (Cheapest! 🎉)" : ""}\n`;
      });
    }

    res.status(200).json({
      fulfillmentResponse: {
        messages: [{ text: { text: [responseText] } }],
      },
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(200).json({
      fulfillmentResponse: {
        messages: [
          {
            text: {
              text: [
                "⚠️ System error while fetching prices. Please try again.",
              ],
            },
          },
        ],
      },
    });
  }
});

// Bind to PORT provided by Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
