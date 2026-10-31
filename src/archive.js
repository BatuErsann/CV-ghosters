const DEMO_IDS = new Set(["listing_acme_backend", "listing_northstar_product", "listing_orbit_data"]);

function publicArchive(store) {
  // Exclude known development fixtures without deleting stored records or
  // hiding genuine submissions added under a different listing ID.
  const listings = store.listings.filter((listing) => !DEMO_IDS.has(listing.id));
  const ids = new Set(listings.map((listing) => listing.id));
  return {
    ...store,
    listings,
    submissions: store.submissions.filter((submission) => ids.has(submission.listingId))
  };
}

function emptyArchive() {
  return { listings: [], submissions: [], reports: [], corrections: [] };
}

module.exports = { publicArchive, emptyArchive };
