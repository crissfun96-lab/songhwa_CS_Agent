// Firestore queue listener — drains `wa_notification_queue` via onSnapshot.

import admin from "firebase-admin";

const QUEUE_COLLECTION = "wa_notification_queue";
const MAX_ATTEMPTS = 3;

export class QueueListener {
  constructor(waClient) {
    this.waClient = waClient;
    this.db = admin.firestore();
    this.unsubscribe = null;
    this.processing = new Set();
  }

  start() {
    console.log("Subscribing to Firestore queue...");

    // Listen only to unsent + non-dead items (no orderBy to avoid composite index)
    // Items that exceed MAX_ATTEMPTS are marked with deadAt so they stop being re-delivered
    this.unsubscribe = this.db
      .collection(QUEUE_COLLECTION)
      .where("sentAt", "==", null)
      .limit(50)
      .onSnapshot(
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === "added" || change.type === "modified") {
              this._processItem(change.doc);
            }
          });
        },
        (err) => {
          console.error("Snapshot error:", err.message);
          console.log("Retrying in 30s...");
          setTimeout(() => this.start(), 30000);
        },
      );

    console.log("✓ Listener active\n");
  }

  async _processItem(docSnap) {
    const id = docSnap.id;
    if (this.processing.has(id)) return;
    this.processing.add(id);

    try {
      const data = docSnap.data();
      if (data.sentAt) return;
      if (data.deadAt) return; // already marked dead, ignore
      if (data.attempts >= MAX_ATTEMPTS) {
        console.log(`[${id}] max attempts reached — marking dead`);
        await docSnap.ref.update({
          deadAt: new Date().toISOString(),
          sentAt: new Date().toISOString(), // also set sentAt=non-null so snapshot filter excludes it
          finalError: data.error ?? "Max retry attempts exceeded",
        });
        return;
      }
      if (!this.waClient.isReady()) {
        console.log(`[${id}] WA not ready yet, will retry`);
        return;
      }

      console.log(`[${id}] sending ${data.type}...`);
      await this.waClient.send(data.message);

      await docSnap.ref.update({
        sentAt: new Date().toISOString(),
        attempts: (data.attempts ?? 0) + 1,
      });
      console.log(`[${id}] ✓ sent`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${id}] send failed: ${msg}`);
      try {
        await docSnap.ref.update({
          attempts: admin.firestore.FieldValue.increment(1),
          error: msg.slice(0, 300),
          lastAttemptAt: new Date().toISOString(),
        });
      } catch (updateErr) {
        console.error(`[${id}] could not record error:`, updateErr);
      }
    } finally {
      this.processing.delete(id);
    }
  }

  stop() {
    if (this.unsubscribe) this.unsubscribe();
  }
}
