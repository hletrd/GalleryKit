
import { db, topics } from './index';

async function seed() {
    console.debug('Seeding topics...');
    await db.insert(topics).ignore().values([
        { slug: 'idol', label: 'Idols', order: 1 },
        { slug: 'plane', label: 'Planes', order: 2 },
    ]);
    console.debug('Seeding complete.');
}

seed();
