const functions = require('firebase-functions/v1');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const TronWebImport = require('tronweb');

const TronWeb = TronWebImport.TronWeb || TronWebImport.default || TronWebImport;

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// المفتاح الخاص بك (تأكد إنه منسوخ صح بدون فراغات)
const TRONGRID_API_KEY = '389b4b1f-ba12-4322-92ab-234dd2260ea4';
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

function getTronWeb() {
  return new TronWeb({
    fullHost: 'https://api.trongrid.io',
    headers: { "TRON-PRO-API-KEY": TRONGRID_API_KEY } // تأمين المفتاح هنا
  });
}

exports.checkDepositsTask = functions.pubsub
  .schedule('every 5 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    logger.info('SCAN START');
    const tronWeb = getTronWeb();

    try {
      const usersSnap = await db.collection('users').get();
      
      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        const address = userData.depositAddress;

        if (!address || !tronWeb.isAddress(address)) continue;

        try {
          // إضافة تأخير بسيط لمنع الـ Rate Limit
          await new Promise(r => setTimeout(r, 500));

          // جلب الحركات باستخدام TronWeb مباشرة بدل fetch اليدوي لضمان استقرار المفتاح
          const url = `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?limit=20&contract_address=${USDT_CONTRACT}`;
          
          const response = await fetch(url, {
            headers: { 'TRON-PRO-API-KEY': TRONGRID_API_KEY }
          });

          if (!response.ok) throw new Error(`TronGrid Error: ${response.status}`);
          const result = await response.json();
          const txs = result.data || [];

          for (const tx of txs) {
            const txId = tx.transaction_id;
            if (tx.to !== address) continue;

            const txRef = userDoc.ref.collection('processedDeposits').doc(txId);
            const txDoc = await txRef.get();
            if (txDoc.exists) continue;

            const amount = Number(tx.value) / 1000000; // تحويل من Sun لـ USDT
            if (amount <= 0) continue;

            const batch = db.batch();
            batch.update(userDoc.ref, {
              balance: admin.firestore.FieldValue.increment(amount),
              totalDeposited: admin.firestore.FieldValue.increment(amount),
              lastDepositAt: admin.firestore.FieldValue.serverTimestamp()
            });

            batch.set(userDoc.ref.collection('deposits').doc(txId), {
              txId, amount, status: 'completed', timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            batch.set(txRef, { txId, processedAt: admin.firestore.FieldValue.serverTimestamp() });

            await batch.commit();
            logger.info(`✅ DEPOSIT SUCCESS: ${amount} USDT for ${userDoc.id}`);
          }
        } catch (err) {
          logger.error('Wallet check failed', { address, error: err.message });
        }
      }
    } catch (err) {
      logger.error('GLOBAL ERROR', { error: err.message });
    }
    logger.info('SCAN END');
    return null;
  });
