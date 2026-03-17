// src/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Bawaal Seeding started...');

  // ---------------------------------------------------------
  // 🍿 1. MOCK MOVIES
  // ---------------------------------------------------------
  const moviesData = [
    { title: 'Batman: The Dark Knight', language: 'English', durationMins: 152 },
    { title: 'Inception', language: 'English', durationMins: 148 },
    { title: 'Pushpa 2: The Rule', language: 'Telugu', durationMins: 165 },
  ];

  const movies = [];
  for (const m of moviesData) {
    const movie = await prisma.movie.create({
      data: { ...m, releaseDate: new Date() }
    });
    movies.push(movie);
  }
  console.log('✅ 3 Movies created!');

  // ---------------------------------------------------------
  // 🏙️ 2. MOCK CITIES & VENUES
  // ---------------------------------------------------------
  const city1 = await prisma.city.create({ data: { name: 'Mumbai', state: 'MH' } });
  const city2 = await prisma.city.create({ data: { name: 'Delhi', state: 'DL' } });

  const venue1 = await prisma.venue.create({
    data: { name: 'PVR Andheri', address: 'Infinity Mall', cityId: city1.id }
  });
  const venue2 = await prisma.venue.create({
    data: { name: 'INOX Select City', address: 'Saket', cityId: city2.id }
  });
  console.log('✅ Cities & Venues ready!');

  // ---------------------------------------------------------
  // 📺 3. SCREENS & SEATS (Creating a full row A1 to A5)
  // ---------------------------------------------------------
  const screen1 = await prisma.screen.create({
    data: { name: 'IMAX Screen 1', venueId: venue1.id, totalRows: 10, totalCols: 10 }
  });
  const screen2 = await prisma.screen.create({
    data: { name: '4DX Screen 2', venueId: venue2.id, totalRows: 10, totalCols: 10 }
  });

  // Helper function to create 5 seats for a given screen
  const createSeatsForScreen = async (screenId: string) => {
    const seatIds = [];
    for (let i = 1; i <= 5; i++) {
      const seat = await prisma.seat.create({
        data: { screenId, rowLabel: 'A', colNumber: i, basePrice: 250.00 + (i * 10) } // Premium for middle seats
      });
      seatIds.push(seat.id);
    }
    return seatIds;
  };

  const screen1Seats = await createSeatsForScreen(screen1.id);
  const screen2Seats = await createSeatsForScreen(screen2.id);
  console.log('✅ 10 Seats (A1 to A5) created across 2 screens!');

  // ---------------------------------------------------------
  // ⏰ 4. SHOWS & SHOW-SEATS
  // ---------------------------------------------------------
  // Show 1: Batman in Mumbai
  const show1 = await prisma.show.create({
    data: {
      movieId: movies[0].id, screenId: screen1.id,
      startTime: new Date(), endTime: new Date(Date.now() + 152 * 60000),
      language: 'English', format: 'IMAX'
    }
  });

  // Show 2: Inception in Delhi
  const show2 = await prisma.show.create({
    data: {
      movieId: movies[1].id, screenId: screen2.id,
      startTime: new Date(), endTime: new Date(Date.now() + 148 * 60000),
      language: 'English', format: '4DX'
    }
  });

  // Link Seats to Shows (The actual lockable inventory)
  for (const seatId of screen1Seats) {
    await prisma.showSeat.create({ data: { showId: show1.id, seatId: seatId, status: 'AVAILABLE' } });
  }
  for (const seatId of screen2Seats) {
    await prisma.showSeat.create({ data: { showId: show2.id, seatId: seatId, status: 'AVAILABLE' } });
  }

  console.log('\n==================================================');
  console.log('🎉 DB SEEDING COMPLETE! GRAB YOUR IDS BELOW:');
  console.log('==================================================');
  
  console.log(`\n🍿 SHOW 1: BATMAN (Mumbai - PVR Andheri)`);
  console.log(`👉 SHOW_ID: ${show1.id}`);
  console.log(`👉 AVAILABLE SEAT IDs (A1 to A5):`);
  screen1Seats.forEach((id, idx) => console.log(`   [A${idx + 1}] -> ${id}`));

  console.log(`\n🍿 SHOW 2: INCEPTION (Delhi - INOX Saket)`);
  console.log(`👉 SHOW_ID: ${show2.id}`);
  console.log(`👉 AVAILABLE SEAT IDs (A1 to A5):`);
  screen2Seats.forEach((id, idx) => console.log(`   [A${idx + 1}] -> ${id}`));
  
  console.log('==================================================');
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());