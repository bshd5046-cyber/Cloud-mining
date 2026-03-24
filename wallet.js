import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore, doc, onSnapshot, collection, query, orderBy, limit, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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

// Variables
let currentAddr = "";
let qrGenerated = false;
let currentUser = null;
let currentUserData = null;

// حدود السحب لكل مرحلة (Tiers)
const TIER_LIMITS = {
    "Tier 1": 500,
    "Tier 2": 2000,
    "Tier 3": 5000,
    "Tier 4": 8000,
    "Tier 5": 10000
};

// Selectors
const withdrawAmountInput = document.getElementById('withdrawAmount');
const feeDisplay = document.getElementById('feeAmount');
const finalDisplay = document.getElementById('finalAmount');
const submitWithdrawBtn = document.getElementById('submitWithdrawBtn');

const formatCurrency = (amount) => `$${parseFloat(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// --- Sync User Data ---
onAuthStateChanged(auth, user => {
    if (user) {
        currentUser = user;
        onSnapshot(doc(db, "users", user.uid), (snap) => {
            const data = snap.data();
            if (data) {
                currentUserData = data;
                document.getElementById('userBalance').innerText = formatCurrency(data.balance || 0);
                document.getElementById('userName').innerText = data.fullName || "USER";
                document.getElementById('userTier').innerText = data.tier || "Tier 1";
                if (data.depositAddress) enableAddressUI(data.depositAddress);
            }
        });
        loadTransactions(user.uid);
    } else {
        window.location.href = 'login.html';
    }
});

// --- Calculation Logic (5% Fee) ---
withdrawAmountInput.addEventListener('input', () => {
    const amount = parseFloat(withdrawAmountInput.value) || 0;
    const fee = amount * 0.05; // عمولة 5%
    const final = amount - fee;

    feeDisplay.innerText = formatCurrency(fee);
    finalDisplay.innerText = formatCurrency(final > 0 ? final : 0);
});

// --- Withdraw Request Logic ---
submitWithdrawBtn.onclick = async () => {
    const amount = parseFloat(withdrawAmountInput.value);
    const address = document.getElementById('withdrawAddress').value;
    const network = document.getElementById('withdrawNetwork').value;
    const userTier = currentUserData?.tier || "Tier 1";
    const maxLimit = TIER_LIMITS[userTier] || 500;

    // 1. التحقق من الحقول
    if (!address || isNaN(amount)) {
        return showError("Please fill all fields correctly.");
    }

    // 2. التحقق من الحد الأدنى (10$)
    if (amount < 10) {
        return showError("Minimum withdrawal is $10.00");
    }

    // 3. التحقق من سقف المرحلة (Tier Limit)
    if (amount > maxLimit) {
        return showError(`Your current ${userTier} limit is ${formatCurrency(maxLimit)}`);
    }

    // 4. التحقق من توفر الرصيد
    if (amount > (currentUserData?.balance || 0)) {
        return showError("Insufficient balance in your vault.");
    }

    try {
        submitWithdrawBtn.disabled = true;
        submitWithdrawBtn.innerText = "Processing...";

        // إرسال الطلب إلى مجموعة "withdrawals" ليراها الأدمن
        // وأيضاً إلى معاملات المستخدم كحالة "Pending"
        const withdrawData = {
            uid: currentUser.uid,
            email: currentUser.email,
            fullName: currentUserData.fullName,
            amount: amount,
            fee: amount * 0.05,
            netAmount: amount * 0.95,
            address: address,
            network: network,
            status: "pending", // الحالة الافتراضية للادمن
            timestamp: serverTimestamp(),
            tierAtTime: userTier
        };

        // إضافة الطلب في سجل الإدارة العام
        await addDoc(collection(db, "withdrawals"), withdrawData);
        
        // إضافة الطلب في سجل المستخدم الخاص
        await addDoc(collection(db, "users", currentUser.uid, "transactions"), {
            type: "withdrawal",
            amount: amount,
            status: "pending",
            timestamp: serverTimestamp(),
            details: `Withdrawal via ${network}`
        });

        Swal.fire({
            title: 'Request Sent!',
            text: 'Your withdrawal is being reviewed by our team.',
            icon: 'success',
            background: '#070b16',
            color: '#fff',
            confirmButtonColor: '#3b82f6'
        });

        document.getElementById('withdrawPanel').classList.remove('show-panel');
        withdrawAmountInput.value = "";
        
    } catch (error) {
        console.error(error);
        showError("Transaction failed. Please try again.");
    } finally {
        submitWithdrawBtn.disabled = false;
        submitWithdrawBtn.innerText = "Submit Request";
    }
};

function showError(msg) {
    Swal.fire({ icon: 'error', title: 'Action Denied', text: msg, background: '#070b16', color: '#fff' });
}

// ... بقية دوال الـ UI (فتح القوائم، النسخ، تحميل المعاملات) كما هي في كودك الأصلي ...
