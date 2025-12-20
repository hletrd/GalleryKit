
import { db, topics } from './index';

async function seed() {
    console.log('Seeding topics...');
    await db.insert(topics).ignore().values([
        { slug: 'IDOL', label: 'Idols', order: 1 },
        { slug: 'PLANE', label: 'Planes', order: 2 },
    ]);
    console.log('Seeding complete.');
}

seed();
