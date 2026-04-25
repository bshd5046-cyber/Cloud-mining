const functions = require('firebase-functions');
const admin = require('firebase-admin');
const TronWeb = require('tronweb');

// تهيئة التطبيق - ضرورية جداً للوصول لقاعدة البيانات
if (admin.apps.length === 0) {
    admin.initializeApp();
}

// المفتاح الخاص بك الذي أرسلته لي
const TRON_PRO_API_KEY = '389b4b1f-ba12-4322-92ab-234dd2260ea4'; 

exports.checkDepositsTask = functions.pubsub.schedule('every 10 minutes').onRun(async (context) => {
    const tronWeb = new TronWeb({ 
        fullHost: 'https://api.trongrid.io',
        headers: { "TRON-PRO-API-KEY": TRON_PRO_API_KEY }
    });

    try {
        const usersSnap = await admin.firestore().collection('users').get();
        console.log(`بدء فحص الإيداعات لـ ${usersSnap.size} مستخدم...`);

        for (const userDoc of usersSnap.docs) {
            const userData = userDoc.data();
            const address = userData.depositAddress;

            if (!address) continue;

            try {
                // تأخير بسيط لمنع حظر الطلبات (Rate Limit)
                await new Promise(resolve => setTimeout(resolve, 500));

                // فحص رصيد الـ USDT (عقد TRC20)
                const contract = await tronWeb.contract().at("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
                const balanceInChain = await contract.balanceOf(address).call();
                
                const actualBalance = parseFloat(tronWeb.fromSun(balanceInChain.toString()));
                const totalDeposited = parseFloat(userData.totalDeposited || 0);

                // مقارنة الرصيد في الشبكة مع المسجل في الموقع
                if (actualBalance > totalDeposited) {
                    const amountToAdd = actualBalance - totalDeposited;

                    await userDoc.ref.update({
                        balance: admin.firestore.FieldValue.increment(amountToAdd),
                        totalDeposited: actualBalance,
                        lastDepositUpdate: admin.firestore.FieldValue.serverTimestamp()
                    });

                    console.log(`✅ نجاح: تم إضافة ${amountToAdd} USDT للمستخدم ${userDoc.id}`);
                }
            } catch (err) {
                // تسجيل الخطأ لكل محفظة بشكل منفصل لفهمه
                console.error(`❌ فشل فحص العنوان ${address}:`, err.message);
            }
        }
    } catch (globalError) {
        console.error("❌ خطأ عام في الدالة:", globalError.message);
    }
    
    return null;
});
