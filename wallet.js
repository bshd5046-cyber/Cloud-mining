import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore, doc, onSnapshot, collection, query, orderBy, limit, addDoc, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- إعدادات Firebase ---
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

// --- اختيار العناصر ---
const depositTrigger = document.getElementById('depositTrigger');
const withdrawTrigger = document.getElementById('withdrawTrigger');
const depositPanel = document.getElementById('depositPanel');
const withdrawPanel = document.getElementById('withdrawPanel');
const closeDep = document.getElementById('closeDep');
const closeWithdraw = document.getElementById('closeWithdraw');
const copyBtn = document.getElementById('copyBtn');
const withdrawAmountInput = document.getElementById('withdrawAmount');
const vaultPinInput = document.getElementById('vaultPin');
const submitWithdrawBtn = document.getElementById('submitWithdrawBtn');

const formatCurrency = (amount) => `$${parseFloat(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// --- مراقبة حالة المستخدم ---
onAuthStateChanged(auth, user => {
    if (user) {
        currentUser = user;
        onSnapshot(doc(db, "users", user.uid), (snap) => {
            const data = snap.data();
            if (data) {
                currentUserData = data;
                updateUI(data);
            }
        });
        loadTransactions(user.uid);
    } else {
        window.location.href = 'login.html';
    }
});

// تحديث واجهة المستخدم بالبيانات الحقيقية
function updateUI(data) {
    document.getElementById('userBalance').innerText = formatCurrency(data.balance || 0);
    document.getElementById('userName').innerText = data.fullName || "GUEST";
    const tier = data.tier || "Tier 1";
    document.getElementById('userTier').innerText = tier;
    
    // تحديث نافذة السحب
    if(document.getElementById('displayTier')) document.getElementById('displayTier').innerText = `${tier} Status`;
    if(document.getElementById('displayLimit')) document.getElementById('displayLimit').innerText = `LIMIT: ${formatCurrency(TIER_LIMITS[tier])}`;
    
    if (data.depositAddress) enableAddressUI(data.depositAddress);
}

// --- معالجة طلب السحب ---
submitWithdrawBtn.onclick = async () => {
    const amount = parseFloat(withdrawAmountInput.value);
    const address = document.getElementById('withdrawAddress').value;
    const network = document.getElementById('withdrawNetwork').value;
    const enteredPin = vaultPinInput.value;
    const userTier = currentUserData?.tier || "Tier 1";
    const maxLimit = TIER_LIMITS[userTier] || 500;

    // 1. التحقق من الحقول الأساسية
    if (!address || isNaN(amount) || !enteredPin) {
        return showError("All fields including Security PIN are required.");
    }

    // 2. التحقق من الـ PIN (يجب أن يكون مخزناً في Firestore كـ withdrawalPin)
    if (enteredPin !== currentUserData?.withdrawalPin) {
        return showError("Security Vault PIN is incorrect.");
    }

    // 3. التحقق من الحد الأدنى
    if (amount < 10) {
        return showError("Minimum withdrawal is $10.00");
    }

    // 4. التحقق من سقف المرحلة (Tier Limit)
    if (amount > maxLimit) {
        return showError(`Limit Exceeded: Your ${userTier} limit is ${formatCurrency(maxLimit)}`);
    }

    // 5. التحقق من الرصيد
    if (amount > (currentUserData?.balance || 0)) {
        return showError("Insufficient funds in your vault.");
    }

    try {
        submitWithdrawBtn.disabled = true;
        submitWithdrawBtn.innerText = "Verifying Protocol...";

        const withdrawData = {
            uid: currentUser.uid,
            email: currentUser.email,
            fullName: currentUserData.fullName,
            amount: amount,
            fee: amount * 0.05,
            netAmount: amount * 0.95,
            address: address,
            network: network,
            status: "pending",
            timestamp: serverTimestamp(),
            tierAtTime: userTier
        };

        // تسجيل الطلب للإدارة
        await addDoc(collection(db, "withdrawals"), withdrawData);
        
        // تسجيل المعاملة في سجل المستخدم
        await addDoc(collection(db, "users", currentUser.uid, "transactions"), {
            type: "Withdrawal",
            amount: amount,
            status: "pending",
            timestamp: serverTimestamp(),
            details: `Net: ${formatCurrency(amount * 0.95)} | Network: ${network}`
        });

        Swal.fire({
            title: 'Protocol Initiated',
            text: 'Withdrawal request sent. Approval may take 2-120 hours.',
            icon: 'success',
            background: '#070b16', color: '#fff', confirmButtonColor: '#3b82f6'
        });

        withdrawPanel.classList.remove('show-panel');
        clearInputs();
        
    } catch (error) {
        showError("Blockchain relay error. Please try again.");
    } finally {
        submitWithdrawBtn.disabled = false;
        submitWithdrawBtn.innerText = "Initiate Payout";
    }
};

// --- وظائف مساعدة ---
function clearInputs() {
    withdrawAmountInput.value = "";
    vaultPinInput.value = "";
    document.getElementById('withdrawAddress').value = "";
}

function enableAddressUI(address) {
    document.getElementById('depositAddrText').innerText = address;
    copyBtn.disabled = false;
    if (!qrGenerated) {
        document.getElementById("qrcode").innerHTML = "";
        new QRCode(document.getElementById("qrcode"), { text: address, width: 180, height: 180, colorDark: "#000000", colorLight: "#ffffff" });
        qrGenerated = true;
    }
}

function loadTransactions(uid) {
    const q = query(collection(db, "users", uid, "transactions"), orderBy("timestamp", "desc"), limit(15));
    onSnapshot(q, (snapshot) => {
        const historyCont = document.getElementById('transactionHistory');
        historyCont.innerHTML = "";
        
        if (snapshot.empty) {
            historyCont.innerHTML = '<p class="text-center text-[10px] text-slate-500 py-10 tracking-widest uppercase italic">Vault is Empty</p>';
            return;
        }

        snapshot.forEach(doc => {
            const tx = doc.data();
            const date = tx.timestamp?.toDate().toLocaleString('en-US', {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'}) || "Processing";
            const statusClass = tx.status === 'pending' ? 'text-amber-500' : (tx.status === 'approved' ? 'text-emerald-500' : 'text-rose-500');
            
            historyCont.innerHTML += `
                <div class="p-4 flex justify-between items-center border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                    <div class="flex items-center gap-4">
                        <div class="w-10 h-10 rounded-full flex items-center justify-center ${tx.type === 'Withdrawal' ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-500'}">
                            <i class="fas ${tx.type === 'Withdrawal' ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i>
                        </div>
                        <div>
                            <p class="text-[11px] font-black uppercase tracking-wider">${tx.type}</p>
                            <p class="text-[9px] text-slate-500 font-bold uppercase">${date}</p>
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="text-sm font-black italic ${tx.type === 'Withdrawal' ? 'text-slate-100' : 'text-emerald-400'}">${tx.type === 'Withdrawal' ? '-' : '+'}${formatCurrency(tx.amount)}</p>
                        <p class="text-[8px] font-black uppercase tracking-tighter ${statusClass}">${tx.status}</p>
                    </div>
                </div>
            `;
        });
    });
}

function showError(msg) {
    Swal.fire({ icon: 'error', title: 'Action Denied', text: msg, background: '#070b16', color: '#fff', confirmButtonColor: '#ef4444' });
}

// الأحداث
depositTrigger.onclick = () => depositPanel.classList.add('show-panel');
closeDep.onclick = () => depositPanel.classList.remove('show-panel');
withdrawTrigger.onclick = () => {
    document.getElementById('withdrawAvailableBalance').innerText = formatCurrency(currentUserData?.balance || 0);
    withdrawPanel.classList.add('show-panel');
};
closeWithdraw.onclick = () => withdrawPanel.classList.remove('show-panel');
copyBtn.onclick = async () => {
    const addr = document.getElementById('depositAddrText').innerText;
    if(addr === "---") return;
    await navigator.clipboard.writeText(addr);
    Swal.fire({ title: 'Address Copied', icon: 'success', toast: true, position: 'top', showConfirmButton: false, timer: 2000, background: '#1e293b', color: '#fff' });
};
