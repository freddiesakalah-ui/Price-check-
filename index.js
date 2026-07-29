const express = require("express");
const Airtable = require("airtable");

const app = express();
app.use(express.json());

/*
====================================================
 Airtable Configuration
====================================================
*/

const base = new Airtable({
  apiKey: process.env.AIRTABLE_ACCESS_TOKEN,
}).base(process.env.AIRTABLE_BASE_ID);

/*
====================================================
 Helper Function
====================================================
*/

function escapeFormula(value) {
  if (!value) return "";
  return String(value).trim().replace(/"/g, '\\"');
}

/*
====================================================
 Health Check
====================================================
*/

app.get("/", (req, res) => {
  res.send("Webhook server is running! 🚀");
});

/*
====================================================
 Dialogflow CX Webhook
====================================================
*/

app.post("/webhook", async (req, res) => {
  try {
    //--------------------------------------------
    // Read Dialogflow Parameters
    //--------------------------------------------

    const params = req.body.sessionInfo?.parameters || {};

    const product = escapeFormula(params.product);
    const city = escapeFormula(params.city);
    const subLocation = escapeFormula(params.sub_location);
    const brand = escapeFormula(params.brand || "Any");

    //--------------------------------------------
    // Validate Parameters
    //--------------------------------------------

    if (!product || !city || !subLocation) {
      return res.json({
        fulfillmentResponse: {
          messages: [
            {
              text: {
                text: [
                  "Please provide a product, city and area before searching."
                ]
              }
            }
          ]
        }
      });
    }

    //--------------------------------------------
    // Build Airtable Formula
    //--------------------------------------------

    let conditions = [
      `FIND(LOWER("${product}"), LOWER({Product Name}))`,
      `LOWER({City}) = LOWER("${city}")`,
      `LOWER({Sub-location}) = LOWER("${subLocation}")`
    ];

    if (brand.toLowerCase() !== "any") {
      conditions.push(
        `LOWER({Brand}) = LOWER("${brand}")`
      );
    }

    const formula = `AND(${conditions.join(",")})`;

    console.log("=================================");
    console.log("Incoming Search");
    console.log("Product:", product);
    console.log("Brand:", brand);
    console.log("City:", city);
    console.log("Area:", subLocation);
    console.log("Formula:", formula);
    console.log("=================================");

    //--------------------------------------------
    // Airtable Query
    //--------------------------------------------

    const records = await base("Prices")
      .select({
        filterByFormula: formula,
        sort: [
          {
            field: "Price",
            direction: "asc"
          }
        ]
      })
      .firstPage();

    //--------------------------------------------
    // No Results
    //--------------------------------------------

    if (records.length === 0) {
      return res.json({
        fulfillmentResponse: {
          messages: [
            {
              text: {
                text: [
                  `No prices found for ${brand !== "Any" ? brand + " " : ""}${product} in ${subLocation}, ${city}.`
                ]
              }
            }
          ]
        }
      });
    }

    //--------------------------------------------
    // Build Response
    //--------------------------------------------

    let responseText = "";

    responseText += "📊 PRICE COMPARISON\n\n";

    responseText += `Product: ${records[0].get("Product Name")}\n`;

    if (brand.toLowerCase() !== "any") {
      responseText += `Brand: ${records[0].get("Brand")}\n`;
    }

    responseText += `Location: ${subLocation}, ${city}\n\n`;

    const medals = ["🥇", "🥈", "🥉"];

    records.forEach((record, index) => {

      const medal = medals[index] || "🔹";

      const shop = record.get("Shop Name") || "Unknown Shop";

      const price = Number(record.get("Price") || 0).toFixed(2);

      responseText += `${medal} ${shop} - $${price}`;

      if (index === 0) {
        responseText += " (Cheapest)";
      }

      responseText += "\n";
    });

    //--------------------------------------------
    // Return to Dialogflow
    //--------------------------------------------

    return res.json({
      fulfillmentResponse: {
        messages: [
          {
            text: {
              text: [responseText]
            }
          }
        ]
      }
    });

  } catch (error) {

    console.error("===============================");
    console.error("WEBHOOK ERROR");
    console.error(error);
    console.error("===============================");

    return res.json({
      fulfillmentResponse: {
        messages: [
          {
            text: {
              text: [
                "Sorry, something went wrong while retrieving supermarket prices."
              ]
            }
          }
        ]
      }
    });

  }
});

/*
====================================================
 Start Server
====================================================
*/

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("==================================");
  console.log(`Server listening on port ${PORT}`);
  console.log("Webhook server is running!");
  console.log("==================================");
});

