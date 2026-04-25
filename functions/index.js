const functions = require('firebase-functions');
const admin = require('firebase-admin');
const TronWeb = require('tronweb');

// استخدمنا الـ API Key الخاص بك هنا لضمان عدم الحظر
const TRON_PRO_API_KEY = '389b4b1f-ba12-4322-92ab-234dd2260ea4'; 

exports.checkDepositsTask = functions.pubsub.schedule('every 10 minutes').onRun(async (context) => {
    const tronWeb = new TronWeb({ 
        fullHost: 'https://api.trongrid.io',
        headers: { "TRON-PRO-API-KEY": TRON_PRO_API_KEY }
    });

    const usersSnap = await admin.firestore().collection('users').get();

    for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        const address = userData.depositAddress;

        if (!address) continue;

        try {
            // تأخير 500 ملي ثانية لضمان استقرار الفحص لكل محفظة
            await new Promise(resolve => setTimeout(resolve, 500));

            const contract = await tronWeb.contract().at("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
            const balanceInChain = await contract.balanceOf(address).call();
            
            // تحويل من Sun إلى USDT
            const actualBalance = parseFloat(tronWeb.fromSun(balanceInChain.toString()));
            const totalDeposited = parseFloat(userData.totalDeposited || 0);

            // إذا وجدنا رصيداً جديداً في الشبكة
            if (actualBalance > totalDeposited) {
                const amountToAdd = actualBalance - totalDeposited;

                await userDoc.ref.update({
                    balance: admin.firestore.FieldValue.increment(amountToAdd),
                    totalDeposited: actualBalance,
                    lastDepositUpdate: admin.firestore.FieldValue.serverTimestamp()
                });

                console.log(`✅ Success: Added ${amountToAdd} USDT to user ${userDoc.id}`);
            }
        } catch (err) {
            console.error(`❌ Wallet ${address} check failed:`, err.message);
        }
    }
    return null;
});
