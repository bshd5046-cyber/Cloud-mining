import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, sendEmailVerification } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore, doc, onSnapshot, collection, query, orderBy, limit, 
    addDoc, serverTimestamp, getDoc, where, getDocs, setDoc
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

let currentUser = null;
let currentUserData = null;

// --- مراقبة حالة المستخدم مع فحص التأكيد ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        // تحديث حالة التأكيد من السيرفر
        await user.reload(); 
        
        onSnapshot(doc(db, "users", user.uid), (snap) => {
            currentUserData = snap.data();
            if (currentUserData) updateUI(currentUserData);
        });
        loadTransactions(user.uid);
    } else {
        window.location.href = 'login.html';
    }
});

// --- فتح لوحة السحب مع فحص الإيميل ---
withdrawTrigger.onclick = () => {
    // 1. فحص هل الإيميل مؤكد؟
    if (!currentUser.emailVerified) {
        Swal.fire({
            title: 'Email Not Verified',
            text: 'You must verify your email before withdrawing assets.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Send Verification Link',
            background: '#070b16', color: '#fff'
        }).then((result) => {
            if (result.isConfirmed) {
                sendEmailVerification(currentUser).then(() => {
                    Swal.fire('Sent!', 'Check your inbox (and spam folder).', 'success');
                });
            }
        });
        return;
    }

    // إذا كان مؤكداً، افتح اللوحة
    document.getElementById('withdrawAvailableBalance').innerText = formatCurrency(currentUserData?.balance || 0);
    withdrawPanel.classList.add('show-panel');
};

// --- منطق السحب (التحقق من الـ PIN والطلبات المعلقة) ---
submitWithdrawBtn.onclick = async () => {
    const amount = parseFloat(withdrawAmountInput.value);
    const address = document.getElementById('withdrawAddress').value;
    const enteredPin = vaultPinInput.value;

    // فحص المدخلات
    if (!address || isNaN(amount) || !enteredPin) {
        return showError("Please complete all security fields.");
    }

    // فحص الـ PIN من قاعدة البيانات
    if (enteredPin !== currentUserData?.withdrawalPin) {
        return showError("Security Vault PIN is incorrect.");
    }

    // فحص الرصيد
    if (amount > (currentUserData?.balance || 0)) {
        return showError("Insufficient vault balance.");
    }

    try {
        submitWithdrawBtn.disabled = true;
        submitWithdrawBtn.innerText = "Security Check...";

        // فحص وجود طلبات معلقة لمنع التكرار
        const q = query(collection(db, "withdrawals"), 
            where("uid", "==", currentUser.uid), 
            where("status", "==", "pending")
        );
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            submitWithdrawBtn.disabled = false;
            submitWithdrawBtn.innerText = "Initiate Payout";
            return showError("Protocol Blocked: You already have a pending withdrawal.");
        }

        // تنفيذ الطلب
        const withdrawData = {
            uid: currentUser.uid,
            email: currentUser.email,
            amount: amount,
            address: address,
            status: "pending",
            timestamp: serverTimestamp(),
            verifiedEmail: true // توثيق أن الإيميل كان مؤكداً وقت الطلب
        };

        const docRef = await addDoc(collection(db, "withdrawals"), withdrawData);
        await setDoc(doc(db, "users", currentUser.uid, "withdrawals", docRef.id), withdrawData);

        // تسجيل المعاملة في السجل
        await addDoc(collection(db, "users", currentUser.uid, "transactions"), {
            type: "Withdrawal",
            amount: amount,
            status: "pending",
            timestamp: serverTimestamp()
        });

        Swal.fire({
            title: 'Authorized',
            text: 'Withdrawal initiated successfully.',
            icon: 'success',
            background: '#070b16', color: '#fff'
        });

        withdrawPanel.classList.remove('show-panel');
        clearInputs();

    } catch (error) {
        showError("Relay Error: Connection failed.");
    } finally {
        submitWithdrawBtn.disabled = false;
        submitWithdrawBtn.innerText = "Initiate Payout";
    }
};

// (بقية الدوال المساعدة updateUI و loadTransactions تبقى كما هي في الكود السابق)
