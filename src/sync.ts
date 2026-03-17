// src/sync.ts
import { PrismaClient } from '@prisma/client';
import { esClient } from './config/elasticsearch';

const prisma = new PrismaClient();

// ─── Step 1: Create index if it doesn't exist ─────────────────────────────────
async function createIndexIfNotExists() {
  const exists = await esClient.indices.exists({ index: 'movies' });

  if (!exists) {
    await esClient.indices.create({
      index: 'movies',
      mappings: {
        properties: {
          title:            { type: 'text',     },
          language:         { type: 'keyword'           },
          genre:            { type: 'keyword'           },
          cast:             { type: 'text'              },
          cities:           { type: 'keyword'           },
          venues:           { type: 'keyword'           },
          durationMins:     { type: 'integer'           },
          totalActiveShows: { type: 'integer'           },
        },
      },
    });
    console.log('✅ Created movies index in Elasticsearch');
  } else {
    console.log('✅ movies index already exists — skipping creation');
  }
}

// ─── Step 2: Fetch movies from Postgres + sync to ES ─────────────────────────
async function syncMoviesToES() {
  await createIndexIfNotExists();

  console.log('📦 Fetching movies from Postgres...');

  const movies = await prisma.movie.findMany({
    include: {
      shows: {
        include: {
          screen: {
            include: {
              venue: {
                include: { city: true },
              },
            },
          },
        },
      },
    },
  });

  if (movies.length === 0) {
    console.log('⚠️  No movies found in DB. Run your seed first: npx tsx src/seed.ts');
    return;
  }

  console.log(`📦 Found ${movies.length} movies — syncing to Elasticsearch...`);

  const operations = movies.flatMap((movie) => {
    const playingCities = new Set<string>();
    const playingVenues = new Set<string>();

    movie.shows.forEach((show) => {
      playingVenues.add(show.screen.venue.name);
      playingCities.add(show.screen.venue.city.name);
    });

    return [
      // Action row — tells ES which index and document ID to use
      { index: { _index: 'movies', _id: movie.id } },
      // Document row — the actual data to store
      {
        title:            movie.title,
        language:         movie.language,
        genre:            movie.genre,           // e.g. ["Action", "Thriller"]
        cast:             movie.cast,            // e.g. ["Christian Bale"]
        durationMins:     movie.durationMins,
        cities:           Array.from(playingCities),  // e.g. ["Mumbai", "Delhi"]
        venues:           Array.from(playingVenues),  // e.g. ["PVR", "INOX"]
        totalActiveShows: movie.shows.length,
      },
    ];
  });

  const bulkResponse = await esClient.bulk({ refresh: true, operations });

  if (bulkResponse.errors) {
    // Log which specific documents failed
    const failed = bulkResponse.items.filter((item: any) => item.index?.error);
    console.error(`❌ Sync completed with ${failed.length} errors:`);
    failed.forEach((item: any) => console.error('  -', item.index?.error));
  } else {
    console.log(`✅ Bawaal! Synced ${movies.length} movies with City & Venue info!`);
  }

  // ─── Verify ────────────────────────────────────────────────────────────────
  const count = await esClient.count({ index: 'movies' });
  console.log(`📊 Total documents in Elasticsearch: ${count.count}`);
  console.log('\n🎉 Done! Test your search:');
  console.log('   GET /api/v1/search/movies?q=batman');
  console.log('   GET /api/v1/search/movies?q=mumbai');
  console.log('   GET /api/v1/search/movies?q=PVR\n');
}

// ─── Run ──────────────────────────────────────────────────────────────────────
syncMoviesToES()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });