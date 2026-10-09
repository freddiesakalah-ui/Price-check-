import express from 'express';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.post('/', async (req, res) => {
  const tag = req.body.fulfillmentInfo?.tag;
  const sessionParameters = req.body.sessionInfo?.parameters || {};

  console.log(`[Webhook] Incoming request tagged as: "${tag}"`);

  // =========================================================================
  // FEATURE 1: Google Maps Reverse Geocoding
  // =========================================================================
  if (tag === 'reverseGeocode') {
    const lat = sessionParameters.lat;
    const lng = sessionParameters.lng;

    if (!lat || !lng) {
      console.warn('[reverseGeocode] Missing lat/lng in session parameters.');
      return res.json({
        fulfillmentResponse: {
          messages: [
            {
              text: {
                text: ['Unable to detect GPS coordinates. Please select your city manually.']
              }
            }
          ]
        }
      });
    }

    try {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;

      const response = await fetch(geocodeUrl);
      const data = await response.json();

      let detectedCity = 'Harare';
      let detectedSubLocation = 'Central';

      if (data.status === 'OK' && data.results && data.results.length > 0) {
        const addressComponents = data.results[0].address_components;

        for (const component of addressComponents) {
          if (component.types.includes('locality')) {
            detectedCity = component.long_name;
          }
          if (component.types.includes('sublocality') || component.types.includes('neighborhood')) {
            detectedSubLocation = component.long_name;
          }
        }
      }

      console.log(`[reverseGeocode] Location resolved -> City: "${detectedCity}", Sub-location: "${detectedSubLocation}"`);

      return res.json({
        fulfillmentResponse: {
          messages: [
            {
              text: {
                text: [`📍 Location detected: ${detectedCity} (${detectedSubLocation}). Fetching prices...`]
              }
            }
          ]
        },
        sessionInfo: {
          parameters: {
            city: detectedCity,
            sub_location: detectedSubLocation
          }
        }
      });

    } catch (error) {
      console.error('[reverseGeocode] Error processing request:', error);
      return res.json({
        fulfillmentResponse: {
          messages: [
            {
              text: {
                text: ['Location lookup service encountered an issue. Please select your city manually.']
              }
            }
          ]
        }
      });
    }
  }

  // =========================================================================
  // FEATURE 2: Airtable Price Search & Basket Management
  // =========================================================================
  // Extract all parameters from Dialogflow CX session with fallbacks
  const product = (sessionParameters.product || '').trim();
  const city = (sessionParameters.city || '').trim();
  const subLocation = (sessionParameters.sub_location || sessionParameters.sublocation || '').trim();
  const brand = (sessionParameters.brand || '').trim();
  const flavour = (sessionParameters.flavour || sessionParameters.flavor || '').trim();
  const unit = (sessionParameters.unit || '').trim();

  let cart = Array.isArray(sessionParameters.cart) ? sessionParameters.cart : [];

  try {
    const airtableToken = process.env.AIRTABLE_ACCESS_TOKEN;
    const baseId = process.env.AIRTABLE_BASE_ID;

    // Build formula matching your exact rules
    let formulaConditions = [
      `{Availability} = 'In Stock'`,
      `{Outdated Flag} = 'NO'`
    ];

    if (product) formulaConditions.push(`FIND(LOWER("${product}"), LOWER(ARRAYJOIN({Product}, ",")))`);
    if (city) formulaConditions.push(`FIND(LOWER("${city}"), LOWER(ARRAYJOIN({City}, ",")))`);
    if (brand) formulaConditions.push(`FIND(LOWER("${brand}"), LOWER(ARRAYJOIN({Brand}, ",")))`);
    if (flavour) formulaConditions.push(`FIND(LOWER("${flavour}"), LOWER(ARRAYJOIN({Flavour}, ",")))`);
    if (unit) formulaConditions.push(`FIND(LOWER("${unit}"), LOWER(ARRAYJOIN({Unit}, ",")))`);

    const filterFormula = `AND(${formulaConditions.join(', ')})`;
    const airtableUrl = `https://api.airtable.com/v0/${baseId}/Prices?filterByFormula=${encodeURIComponent(filterFormula)}`;

    const response = await fetch(airtableUrl, {
      headers: { Authorization: `Bearer ${airtableToken}` }
    });

    const data = await response.json();

    if (!data.records || data.records.length === 0) {
      return res.json({
        fulfillmentResponse: {
          messages: [
            {
              text: {
                text: [`No matching items in stock for ${product || 'item'} in ${city || 'your area'}.`]
              }
            }
          ]
        }
      });
    }

    const resultsText = data.records.map(record => {
      const f = record.fields;
      return `• ${f.Store || 'Store'}: $${f.Price || 'N/A'} (${f.City || ''})`;
    }).join('\n');

    return res.json({
      fulfillmentResponse: {
        messages: [
          {
            text: {
              text: [`Here are the latest prices found:\n\n${resultsText}`]
            }
          }
        ]
      }
    });

  } catch (error) {
    console.error('[Airtable Search] Error:', error);
    return res.json({
      fulfillmentResponse: {
        messages: [
          {
            text: {
              text: ['An error occurred while retrieving prices. Please try again.']
            }
          }
        ]
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
