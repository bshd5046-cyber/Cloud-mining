const functions = require('firebase-functions');
const admin = require('firebase-admin');
const TronWeb = require('tronweb');

// إذا لم تكن قد قمت بتعريف admin.initializeApp() مسبقاً في الملف، اترك السطر التالي
// admin.initializeApp();

exports.checkDepositsTask = functions.pubsub.schedule('every 10 minutes').onRun(async (context) => {
    // 1. ضع هنا مفتاح الـ API الخاص بك من موقع TronGrid (ضروري جداً لكي لا يفشل الفحص)
    const TRON_API_KEY = 'YOUR_API_KEY_HERE'; 
    
    const tronWeb = new TronWeb({ 
        fullHost: 'https://api.trongrid.io',
        headers: { "TRON-PRO-API-KEY": TRON_API_KEY }
    });

    const usersSnap = await admin.firestore().collection('users').get();

    for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        const address = userData.depositAddress;

        // إذا كان المستخدم ليس لديه عنوان إيداع، نتخطاه
        if (!address) continue;

        try {
            // إضافة تأخير 500 ملي ثانية (نصف ثانية) بين كل فحص لضمان استقرار الدالة
            await new Promise(resolve => setTimeout(resolve, 500));

            // عنوان عقد عملة USDT الرسمي
            const contract = await tronWeb.contract().at("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
            const balanceInChain = await contract.balanceOf(address).call();
            
            // تحويل القيمة من Sun إلى USDT (تقسيم على مليون)
            const actualBalance = parseFloat(tronWeb.fromSun(balanceInChain.toString()));
            const totalDepositedSoFar = parseFloat(userData.totalDeposited || 0);

            // التحقق: هل الرصيد في الشبكة أكبر مما هو مسجل عندنا؟
            if (actualBalance > totalDepositedSoFar) {
                const amountToAdd = actualBalance - totalDepositedSoFar;

                // تحديث رصيد المستخدم وإجمالي الإيداعات في وقت واحد
                await userDoc.ref.update({
                    balance: admin.firestore.FieldValue.increment(amountToAdd),
                    totalDeposited: actualBalance,
                    lastDepositUpdate: admin.firestore.FieldValue.serverTimestamp()
                });

                console.log(`✅ Success: Added ${amountToAdd} USDT to user ${userDoc.id}`);
            }
        } catch (err) {
            // تسجيل الخطأ بوضوح لمعرفته في Logs Explorer
            console.error(`❌ Error checking address ${address}:`, err.message);
        }
    }
    
    console.log("--- Scan Finished ---");
    return null;
});
