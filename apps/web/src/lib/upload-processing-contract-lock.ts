import type { RowDataPacket } from 'mysql2/promise';
import { connection } from '@/db';

const UPLOAD_PROCESSING_CONTRACT_LOCK = 'gallerykit_upload_processing_contract';

type UploadProcessingContractLock = {
    release: () => Promise<void>;
};

export async function acquireUploadProcessingContractLock(timeoutSeconds = 5): Promise<UploadProcessingContractLock | null> {
    const conn = await connection.getConnection();
    let lockAcquired = false;
    let released = false;

    try {
        const [lockRows] = await conn.query<(RowDataPacket & { acquired: number | bigint | null })[]>(
            'SELECT GET_LOCK(?, ?) AS acquired',
            [UPLOAD_PROCESSING_CONTRACT_LOCK, timeoutSeconds],
        );
        const acquired = lockRows[0]?.acquired;
        lockAcquired = acquired === 1 || acquired === BigInt(1);
        if (!lockAcquired) {
            conn.release();
            released = true;
            return null;
        }

        return {
            release: async () => {
                if (released) return;
                released = true;
                try {
                    await conn.query('SELECT RELEASE_LOCK(?)', [UPLOAD_PROCESSING_CONTRACT_LOCK]);
                } catch (err) {
                    console.debug('RELEASE_LOCK (upload processing contract) failed:', err);
                } finally {
                    conn.release();
                }
            },
        };
    } catch (err) {
        if (lockAcquired && !released) {
            await conn.query('SELECT RELEASE_LOCK(?)', [UPLOAD_PROCESSING_CONTRACT_LOCK]).catch(() => {});
        }
        if (!released) {
            conn.release();
        }
        throw err;
    }
}
