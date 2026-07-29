const express = require("express");
const Airtable = require("airtable");

const app = express();

app.use(express.json());

/*
=========================================================
 Airtable Configuration
=========================================================
*/

const base = new Airtable({
  apiKey: process.env.AIRTABLE_ACCESS_TOKEN,
}).base(process.env.AIRTABLE_BASE_ID);

/*
=========================================================
 Helper Function
 Escapes quotation marks inside Airtable formulas
=========================================================
*/

function escapeFormula(value) {
  if (!value) return "";
  return String(value).replace(/"/g, '\\"');
}

/*
=========================================================
 Health Check
=========================================================
*/

app.get("/", (req, res) => {
  res.send("Webhook server is running! 🚀");
});

/*
=========================================================
 Dialogflow CX Webhook
=========================================================
*/

app.post("/webhook", async (req, res) => {
  try {

    //-----------------------------------------------------
    // Read session parameters
    //-----------------------------------------------------

    const params = req.body.sessionInfo?.parameters || {};

    const product =
      escapeFormula(params.product);

    const city =
      escapeFormula(params.city);

    const subLocation =
      escapeFormula(params.sub_location);

    const brand =
      escapeFormula(params.brand || "Any");

    //-----------------------------------------------------
    // Validate required parameters
    //-----------------------------------------------------

    if (!product || !city || !subLocation) {

      return res.json({
        fulfillmentResponse: {
          messages: [
            {
              text: {
                text: [
                  "Please provide Product, City and Area."
                ]
              }
            }
          ]
        }
      });

    }

    //-----------------------------------------------------
    // Build Airtable Formula
    //-----------------------------------------------------

    let conditions = [

      `FIND(LOWER("${product}"), LOWER({Product Name}))`,

      `LOWER({City})=LOWER("${city}")`,

      `LOWER({Sub-location})=LOWER("${subLocation}")`

    ];

    if (
      brand &&
      brand.toLowerCase() !== "any"
    ) {
      conditions.push(
        `LOWER({Brand})=LOWER("${brand}")`
      );
    }

    const formula =
      `AND(${conditions.join(",")})`;

    console.log("Formula:");
    console.log(formula);

    //-----------------------------------------------------
    // Query Airtable
    //-----------------------------------------------------

    const records = await base("Prices")
      .select({
        filterByFormula: formula,
        sort: [
          {
            field: "Price",
            direction: "asc",
          },
        ],
      })
      .firstPage();

    //-----------------------------------------------------
    // No Results
    //-----------------------------------------------------

    if (records.length === 0) {

      return res.json({
        fulfillmentResponse: {
          messages: [
            {
              text: {
                text: [
                  `❌ No prices found for ${brand !== "Any" ? brand + " " : ""}${product} in ${subLocation}, ${city}.`
                ]
              }
            }
          ]
        }
      });

    }

    //-----------------------------------------------------
    // Build Response
    //-----------------------------------------------------

    let response =
`📊 Price Comparison

Product: ${records[0].get("Product Name")}

Brand: ${brand}

Location: ${subLocation}, ${city}

`;

    const medals = [
      "🥇",
  console.log(`Server listening on port ${PORT}`)
)
