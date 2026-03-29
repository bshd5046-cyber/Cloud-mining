import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore, doc, onSnapshot, collection, query, orderBy, limit, 
    addDoc, serverTimestamp, updateDoc, where, getDocs, setDoc, increment
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyAmlAKs35FG4hbcaPkVQ_s0FSaZsvWzFak",
    authDomain: "cloud-mining-6f190.firebaseapp.com",
    projectId: "cloud-mining-6f190",
    storageBucket: "cloud-mining-6f190.firebasestorage.app",
    messagingSenderId: "144227180849",
    appId: "1:144227180849:web:ccbda447d074efbbddd010"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let currentUserData = null;
const TIER_LIMITS = { "Tier 1": 500, "Tier 2": 2000, "Tier 3": 5000, "Tier 4": 8000, "Tier 5": 10000 };

// --- 1. مراقبة حالة المستخدم وتحديث الرصيد لحظياً ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        onSnapshot(doc(db, "users", user.uid), (snap) => {
            currentUserData = snap.data();
            if (currentUserData) updateUI(currentUserData);
        });
        loadTransactions(user.uid);
    } else {
        window.location.href = 'login.html';
    }
});

function updateUI(data) {
    document.getElementById('userBalance').innerText = `$${parseFloat(data.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    document.getElementById('userName').innerText = data.fullName || "User";
    document.getElementById('userTier').innerText = data.tier || "Tier 1";
    if (data.depositAddress) enableAddressUI(data.depositAddress);
}

// --- 2. منطق فتح لوحة السحب (شرط وجود PIN) ---
document.getElementById('withdrawTrigger').onclick = () => {
    if (!currentUserData?.withdrawalPin || currentUserData.withdrawalPin === "") {
        return Swal.fire({
            title: 'Security Alert',
            text: 'You must set a 6-digit Security PIN in your profile before withdrawing.',
            icon: 'lock',
            showCancelButton: true,
            confirmButtonText: 'Go to Profile',
            background: '#070b16', color: '#fff'
        }).then(res => { if(res.isConfirmed) window.location.href = 'profile.html'; });
    }
    document.getElementById('withdrawAvailableBalance').innerText = `Available: $${parseFloat(currentUserData.balance).toFixed(2)}`;
    document.getElementById('withdrawPanel').classList.add('show-panel');
};

// --- 3. تنفيذ عملية السحب (الخصم + الإرسال للآدمن) ---
document.getElementById('submitWithdrawBtn').onclick = async () => {
    const amount = parseFloat(document.getElementById('withdrawAmount').value);
    const address = document.getElementById('withdrawAddress').value;
    const pin = document.getElementById('vaultPin').value;
    const netAmount = amount * 0.95; // خصم عمولة 5% مثلاً

    if (!address || isNaN(amount) || pin.length !== 6) return showError("Complete all fields correctly.");
    if (pin !== currentUserData.withdrawalPin) return showError("Incorrect Security PIN.");
    if (amount < 10) return showError("Minimum withdrawal is $10.");
    if (amount > (currentUserData.balance || 0)) return showError("Insufficient balance.");

    try {
        const btn = document.getElementById('submitWithdrawBtn');
        btn.disabled = true;
        btn.innerText = "Securing Funds...";

        // أ. خصم الرصيد فوراً من حساب المستخدم (للحماية من التلاعب)
        const userRef = doc(db, "users", currentUser.uid);
        await updateDoc(userRef, { balance: increment(-amount) });

        // ب. إنشاء طلب سحب للآدمن
        const withdrawData = {
            uid: currentUser.uid,
            email: currentUser.email,
            fullName: currentUserData.fullName,
            amount: amount,
            netAmount: netAmount,
            address: address,
            status: "pending",
            timestamp: serverTimestamp(),
            type: "Withdrawal"
        };

        const docRef = await addDoc(collection(db, "withdrawals"), withdrawData);
        
        // ج. تسجيل في سجل معاملات المستخدم
        await addDoc(collection(db, "users", currentUser.uid, "transactions"), {
            type: "Withdrawal",
            amount: amount,
            status: "pending",
            timestamp: serverTimestamp()
        });

        Swal.fire({ title: 'Success', text: 'Funds locked. Payout pending audit.', icon: 'success', background: '#070b16', color: '#fff' });
        document.getElementById('withdrawPanel').classList.remove('show-panel');
        document.getElementById('vaultPin').value = "";
    } catch (e) {
        showError("Transaction failed. Contact support.");
    } finally {
        document.getElementById('submitWithdrawBtn').disabled = false;
        document.getElementById('submitWithdrawBtn').innerText = "Initiate Payout";
    }
};

// --- 4. نظام الإيداع (إرسال إثبات للآدمن) ---
// تأكد من إضافة id="submitDeposit" و id="txHash" في الـ HTML الخاص بك
if (document.getElementById('submitDeposit')) {
    document.getElementById('submitDeposit').onclick = async () => {
        const hash = document.getElementById('txHash').value;
        if (!hash) return showError("Please enter Transaction Hash/ID.");

        await addDoc(collection(db, "deposits"), {
            uid: currentUser.uid,
            email: currentUser.email,
            hash: hash,
            status: "pending",
            timestamp: serverTimestamp()
        });
        
        Swal.fire('Sent', 'Deposit proof submitted to admin.', 'success');
        document.getElementById('txHash').value = "";
    };
}

// --- وظائف مساعدة ---
function loadTransactions(uid) {
    const q = query(collection(db, "users", uid, "transactions"), orderBy("timestamp", "desc"), limit(10));
    onSnapshot(q, (snap) => {
        const cont = document.getElementById('transactionHistory');
        cont.innerHTML = "";
        snap.forEach(d => {
            const tx = d.data();
            const color = tx.status === 'pending' ? 'text-amber-500' : 'text-emerald-500';
            cont.innerHTML += `
                <div class="p-4 border-b border-white/5 flex justify-between items-center">
                    <div><p class="text-[10px] font-bold uppercase">${tx.type}</p></div>
                    <div class="text-right">
                        <p class="text-xs font-black">$${parseFloat(tx.amount).toFixed(2)}</p>
                        <p class="text-[8px] uppercase ${color}">${tx.status}</p>
                    </div>
                </div>`;
        });
    });
}

function enableAddressUI(addr) {
    document.getElementById('depositAddrText').innerText = addr;
    const qrCont = document.getElementById('qrcode');
    if (qrCont && qrCont.innerHTML === "") {
        new QRCode(qrCont, { text: addr, width: 160, height: 160 });
    }
}

function showError(m) { Swal.fire({ icon: 'error', title: 'Denied', text: m, background: '#070b16', color: '#fff' }); }

// إغلاق اللوحات
document.querySelectorAll('.close-btn, #closeWithdraw, #closeDep').forEach(b => {
    b.onclick = () => document.querySelectorAll('.slide-panel').forEach(p => p.classList.remove('show-panel'));
});
