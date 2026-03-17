// src/sync.ts
import { PrismaClient } from '@prisma/client';
import { esClient } from './config/elasticsearch';

const prisma = new PrismaClient();

async function syncMoviesToES() {
  console.log('Fetching rich movie data from Postgres...');
  
  const movies = await prisma.movie.findMany({
    include: {
      shows: {
        include: {
          screen: {
            include: {
              venue: {
                include: { city: true }
              }
            }
          }
        }
      }
    }
  });

  if (movies.length === 0) {
    console.log('No movies found in DB.');
    return;
  }

  const operations = movies.flatMap(movie => {
  
    const playingCities = new Set<string>();
    const playingVenues = new Set<string>();

    movie.shows.forEach(show => {
      playingVenues.add(show.screen.venue.name);
      playingCities.add(show.screen.venue.city.name);
    });

    return [
      { index: { _index: 'movies', _id: movie.id } }, // Action
      { 
        title: movie.title, 
        language: movie.language, 
        durationMins: movie.durationMins,
        cities: Array.from(playingCities),
        venues: Array.from(playingVenues),
        totalActiveShows: movie.shows.length
      }
    ];
  });

  try {
    const bulkResponse = await esClient.bulk({ refresh: true, operations });
    if (bulkResponse.errors) {
      console.error('Sync failed with errors.');
    } else {
      console.log(`--Bawaal! Synced ${movies.length} movies with City & Venue info!`);
    }
  } catch (error) {
    console.error('Elasticsearch Error:', error);
  }
}

syncMoviesToES()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });