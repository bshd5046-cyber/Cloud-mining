import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore, doc, onSnapshot, collection, query, orderBy, limit, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- إعدادات Firebase الخاص بك ---
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

// --- متغيرات الحالة ---
let currentUser = null;
let currentUserData = null;
let qrGenerated = false;

// --- حدود السحب لكل مرحلة (Tiers) ---
const TIER_LIMITS = {
    "Tier 1": 500,
    "Tier 2": 2000,
    "Tier 3": 5000,
    "Tier 4": 8000,
    "Tier 5": 10000
};

// --- اختيار العناصر من الصفحة ---
const depositTrigger = document.getElementById('depositTrigger');
const withdrawTrigger = document.getElementById('withdrawTrigger');
const depositPanel = document.getElementById('depositPanel');
const withdrawPanel = document.getElementById('withdrawPanel');
const closeDep = document.getElementById('closeDep');
const closeWithdraw = document.getElementById('closeWithdraw');
const copyBtn = document.getElementById('copyBtn');
const withdrawAmountInput = document.getElementById('withdrawAmount');
const feeDisplay = document.getElementById('feeAmount');
const finalDisplay = document.getElementById('finalAmount');
const submitWithdrawBtn = document.getElementById('submitWithdrawBtn');

// تنسيق العملة
const formatCurrency = (amount) => `$${parseFloat(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// --- مراقبة حالة المستخدم وجلب البيانات ---
onAuthStateChanged(auth, user => {
    if (user) {
        currentUser = user;
        onSnapshot(doc(db, "users", user.uid), (snap) => {
            const data = snap.data();
            if (data) {
                currentUserData = data;
                // تحديث الواجهة الرئيسية
                document.getElementById('userBalance').innerText = formatCurrency(data.balance || 0);
                document.getElementById('userName').innerText = data.fullName || "USER";
                document.getElementById('userTier').innerText = data.tier || "Tier 1";
                
                // تحديث عنوان الإيداع إذا وجد
                if (data.depositAddress) enableAddressUI(data.depositAddress);
            }
        });
        loadTransactions(user.uid);
    } else {
        window.location.href = 'login.html';
    }
});

// --- منطق حساب العمولات (5%) ---
withdrawAmountInput.addEventListener('input', () => {
    const amount = parseFloat(withdrawAmountInput.value) || 0;
    const fee = amount * 0.05; // خصم 5% عمولة
    const final = amount - fee;

    feeDisplay.innerText = formatCurrency(fee);
    finalDisplay.innerText = formatCurrency(final > 0 ? final : 0);
});

// --- إرسال طلب السحب للإدارة ---
submitWithdrawBtn.onclick = async () => {
    const amount = parseFloat(withdrawAmountInput.value);
    const address = document.getElementById('withdrawAddress').value;
    const network = document.getElementById('withdrawNetwork').value;
    const userTier = currentUserData?.tier || "Tier 1";
    const maxLimit = TIER_LIMITS[userTier] || 500;

    // التحقق من المدخلات
    if (!address || isNaN(amount)) {
        return showError("Please enter a valid address and amount.");
    }

    // التحقق من الحد الأدنى (10$)
    if (amount < 10) {
        return showError("Minimum withdrawal is $10.00");
    }

    // التحقق من سقف المرحلة
    if (amount > maxLimit) {
        return showError(`Your current ${userTier} limit is ${formatCurrency(maxLimit)}`);
    }

    // التحقق من الرصيد المتوفر
    if (amount > (currentUserData?.balance || 0)) {
        return showError("Insufficient balance in your vault.");
    }

    try {
        submitWithdrawBtn.disabled = true;
        submitWithdrawBtn.innerText = "Requesting...";

        const withdrawData = {
            uid: currentUser.uid,
            email: currentUser.email,
            fullName: currentUserData.fullName,
            amount: amount,
            fee: amount * 0.05,
            netAmount: amount * 0.95,
            address: address,
            network: network,
            status: "pending", // ستظهر للادمن كـ "قيد الانتظار"
            timestamp: serverTimestamp(),
            tierAtTime: userTier
        };

        // 1. إرسال الطلب لقائمة السحوبات العامة (للأدمن)
        await addDoc(collection(db, "withdrawals"), withdrawData);
        
        // 2. إرسال الطلب لسجل المعاملات الخاص بالمستخدم
        await addDoc(collection(db, "users", currentUser.uid, "transactions"), {
            type: "Withdrawal",
            amount: amount,
            status: "pending",
            timestamp: serverTimestamp(),
            details: `Network: ${network}`
        });

        Swal.fire({
            title: 'Request Sent!',
            text: 'Your withdrawal is pending admin approval.',
            icon: 'success',
            background: '#070b16',
            color: '#fff',
            confirmButtonColor: '#3b82f6'
        });

        // إغلاق اللوحة وتصفير الحقل
        withdrawPanel.classList.remove('show-panel');
        withdrawAmountInput.value = "";
        
    } catch (error) {
        showError("System error. Try again later.");
    } finally {
        submitWithdrawBtn.disabled = false;
        submitWithdrawBtn.innerText = "Submit Request";
    }
};

// --- وظائف مساعدة للواجهة ---
function enableAddressUI(address) {
    document.getElementById('depositAddrText').innerText = address;
    copyBtn.disabled = false;
    copyBtn.classList.remove('copy-disabled');
    
    if (!qrGenerated) {
        document.getElementById("qrcode").innerHTML = "";
        new QRCode(document.getElementById("qrcode"), { text: address, width: 160, height: 160 });
        qrGenerated = true;
    }
}

function loadTransactions(uid) {
    const q = query(collection(db, "users", uid, "transactions"), orderBy("timestamp", "desc"), limit(10));
    onSnapshot(q, (snapshot) => {
        const historyCont = document.getElementById('transactionHistory');
        historyCont.innerHTML = "";
        
        if (snapshot.empty) {
            historyCont.innerHTML = '<p class="text-center text-[10px] text-slate-500 py-4">NO TRANSACTIONS</p>';
            return;
        }

        snapshot.forEach(doc => {
            const tx = doc.data();
            const date = tx.timestamp?.toDate().toLocaleDateString() || "Recent";
            const statusClass = tx.status === 'pending' ? 'status-pending' : (tx.status === 'approved' ? 'status-approved' : 'status-rejected');
            
            historyCont.innerHTML += `
                <div class="history-item p-4 flex justify-between items-center">
                    <div class="flex items-center gap-4">
                        <div class="tx-icon ${tx.type === 'Withdrawal' ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'}">
                            <i class="fas ${tx.type === 'Withdrawal' ? 'fa-arrow-up' : 'fa-arrow-down'}"></i>
                        </div>
                        <div>
                            <p class="text-xs font-black uppercase tracking-wider">${tx.type}</p>
                            <p class="text-[9px] text-slate-500 font-bold uppercase">${date}</p>
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="text-sm font-black italic">${formatCurrency(tx.amount)}</p>
                        <p class="text-[8px] font-black uppercase ${statusClass}">${tx.status}</p>
                    </div>
                </div>
            `;
        });
    });
}

function showError(msg) {
    Swal.fire({ icon: 'error', title: 'Error', text: msg, background: '#070b16', color: '#fff' });
}

// أحداث الأزرار
depositTrigger.onclick = () => depositPanel.classList.add('show-panel');
closeDep.onclick = () => depositPanel.classList.remove('show-panel');
withdrawTrigger.onclick = () => {
    document.getElementById('withdrawAvailableBalance').innerText = formatCurrency(currentUserData?.balance || 0);
    withdrawPanel.classList.add('show-panel');
};
closeWithdraw.onclick = () => withdrawPanel.classList.remove('show-panel');
copyBtn.onclick = async () => {
    await navigator.clipboard.writeText(document.getElementById('depositAddrText').innerText);
    Swal.fire({ title: 'Copied!', icon: 'success', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
};
