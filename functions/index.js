// هذا الكود يتفحص العناوين التي لديها عمليات إيداع جديدة
exports.checkDepositsTask = functions.pubsub.schedule('every 10 minutes').onRun(async (context) => {
    const tronWeb = new TronWeb({ fullHost: 'https://api.trongrid.io' });
    const usersSnap = await admin.firestore().collection('users').get();

    for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        const address = userData.depositAddress;

        if (!address) continue;

        try {
            // جلب الرصيد الحالي من شبكة ترون (مثلاً عملة USDT)
            // ملاحظة: تحتاج لعنوان عقد USDT وهو: TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
            const contract = await tronWeb.contract().at("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
            const balanceInChain = await contract.balanceOf(address).call();
            const actualBalance = tronWeb.fromSun(balanceInChain.toString());

            // إذا كان الرصيد في الشبكة أكبر من الرصيد المسجل عندنا، يعني هناك إيداع جديد
            if (parseFloat(actualBalance) > (userData.totalDeposited || 0)) {
                const amountToAdd = parseFloat(actualBalance) - (userData.totalDeposited || 0);

                await userDoc.ref.update({
                    balance: admin.firestore.FieldValue.increment(amountToAdd),
                    totalDeposited: parseFloat(actualBalance)
                });

                console.log(`Updated balance for user ${userDoc.id}: +${amountToAdd} USDT`);
            }
        } catch (err) {
            console.error(`Error checking address ${address}:`, err);
        }
    }
    return null;
});
