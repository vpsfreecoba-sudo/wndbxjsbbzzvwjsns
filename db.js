const DB_NAME = "tiktok-video-enhancer-db";
const STORE_NAME = "history";
const DB_VERSION = 1;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
        };

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };

        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

export async function saveRecord(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(record);

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

export async function getAllRecords() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = (event) => {
            const records = event.target.result;
            records.sort((a, b) => b.timestamp - a.timestamp);
            resolve(records);
        };

        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

export async function deleteRecord(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

export async function clearAllRecords() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

export async function pruneOldRecords() {
    const db = await openDB();
    const expiryTime = Date.now() - 43200000;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = (event) => {
            const records = event.target.result;
            const deletePromises = [];
            for (const record of records) {
                if (record.timestamp < expiryTime) {
                    deletePromises.push(
                        new Promise((res, rej) => {
                            const delReq = store.delete(record.id);
                            delReq.onsuccess = () => res();
                            delReq.onerror = (e) => rej(e.target.error);
                        }),
                    );
                }
            }
            Promise.all(deletePromises).then(resolve).catch(reject);
        };

        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

export async function getHistoryTotalSize() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.openCursor();
        let total = 0;
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                total += cursor.value.size || 0;
                cursor.continue();
            } else {
                resolve(total);
            }
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}
