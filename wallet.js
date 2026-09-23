import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, doc, onSnapshot, collection, query, orderBy, limit, 
    addDoc, serverTimestamp, updateDoc, where, getDocs, increment 
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

// ⚠️ مفتاح API الخاص بـ Plisio
const PLISIO_API_KEY = "Q4bxjujHY_e8X60i3CHtg-yj3Ivyz2OGqx9WTr1bBrvQx0bEHT40Mt2PHsZ57lsa"; 

let currentUser = null;
let currentUserData = null;
let activeCheckInterval = null;

function showError(msg) {
    Swal.fire({
        icon: 'error',
        title: 'NOTIFICATION',
        text: msg,
        background: '#0a0f1d',
        color: '#fff',
        confirmButtonColor: '#3b82f6',
        backdrop: `rgba(0,0,0,0.85)`,
        position: 'center',
        customClass: {
            popup: 'rounded-[2rem] border border-white/10 shadow-2xl',
            confirmButton: 'rounded-xl px-10 py-2 font-black uppercase text-xs'
        }
    });
}

// --- 1. مراقبة حالة المستخدم والبيانات ---
onAuthStateChanged(auth, user => {
    if (user) {
        currentUser = user;
        onSnapshot(doc(db, "users", user.uid), (snap) => {
            currentUserData = snap.data();
            if (currentUserData) {
                const balanceEl = document.getElementById('userBalance');
                const nameEl = document.getElementById('userName');
                const tierEl = document.getElementById('userTier');

                if (balanceEl) balanceEl.innerText = `$${parseFloat(currentUserData.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
                if (nameEl) nameEl.innerText = currentUserData.fullName || "User";
                if (tierEl) tierEl.innerText = currentUserData.tier || "Tier 1";
            }
        });
        loadTransactions(user.uid);
        checkPendingDeposits(user.uid); // الفحص التلقائي لأي إيداع معلق عند تسجيل الدخول أو تحديث الصفحة
    } else {
        window.location.href = 'login.html';
    }
});

// --- 2. إنشاء فاتورة ومراقبة الدفع التلقائي ---
const createBtn = document.getElementById('createInvoiceBtn');
if (createBtn) {
    createBtn.onclick = async () => {
        const amountInput = document.getElementById('depositAmountInput');
        const amount = parseFloat(amountInput ? amountInput.value : 0);

        if (!currentUser) return showError("Please login to proceed.");
        if (isNaN(amount) || amount <= 0) return showError("Please enter a valid amount.");

        try {
            createBtn.disabled = true;
            createBtn.innerText = "Creating Invoice...";

            const orderNumber = `DEP_${currentUser.uid.substring(0, 5)}_${Date.now()}`;

            // طلب إنشاء فاتورة من Plisio API
            const response = await fetch(`https://plisio.net/api/v1/invoices/new?api_key=${PLISIO_API_KEY}&source_currency=USD&source_amount=${amount}&order_number=${orderNumber}&currency=USDT_BSC`);
            const data = await response.json();

            if (data.status === "success") {
                const invoiceData = data.data;

                // تسجيل الفاتورة كـ pending في Firestore
                const txRef = await addDoc(collection(db, "users", currentUser.uid, "transactions"), {
                    uid: currentUser.uid,
                    amount: amount,
                    type: "Deposit",
                    status: "pending",
                    txn_id: invoiceData.txn_id,
                    orderNumber: orderNumber,
                    timestamp: serverTimestamp()
                });

                // فتح صفحة الدفع
                window.open(invoiceData.invoice_url, '_blank');

                createBtn.innerText = "Awaiting Payment...";

                // بدء التتبع والتحقق
                startAutoCreditCheck(invoiceData.txn_id, txRef.id, amount, createBtn);

            } else {
                showError("Failed to generate invoice. Check Plisio API Key.");
                createBtn.disabled = false;
                createBtn.innerText = "Pay with Crypto (Plisio)";
            }

        } catch (error) {
            console.error("Invoice Error:", error);
            showError("Unexpected error. Please try again.");
            createBtn.disabled = false;
            createBtn.innerText = "Pay with Crypto (Plisio)";
        }
    };
}

// --- دالة الفحص الآلي والشحن الفوري ---
function startAutoCreditCheck(txnId, txDocId, amount, btn) {
    if (activeCheckInterval) clearInterval(activeCheckInterval);

    activeCheckInterval = setInterval(async () => {
        try {
            const res = await fetch(`https://plisio.net/api/v1/operations/${txnId}?api_key=${PLISIO_API_KEY}`);
            const result = await res.json();

            if (result.status === "success" && (result.data.status === "completed" || result.data.status === "mismatch")) {
                clearInterval(activeCheckInterval);

                // إضافة الرصيد تلقائياً
                await updateDoc(doc(db, "users", currentUser.uid), { 
                    balance: increment(amount) 
                });

                // تحديث المعاملة إلى completed
                await updateDoc(doc(db, "users", currentUser.uid, "transactions", txDocId), { 
                    status: "completed" 
                });

                Swal.fire({
                    icon: 'success',
                    title: 'DEPOSIT SUCCESSFUL',
                    text: `$${amount} credited to your account balance!`,
                    background: '#0a0f1d', color: '#fff',
                    confirmButtonColor: '#10b981'
                });

                if (btn) {
                    btn.disabled = false;
                    btn.innerText = "Pay with Crypto (Plisio)";
                }
            }
        } catch (e) {
            console.error("Polling check failed:", e);
        }
    }, 10000); // يفحص كل 10 ثوانٍ
}

// --- فحص المعاملات المعلقة في حال إغلاق المتصفح وإعادة فتحه ---
async function checkPendingDeposits(uid) {
    try {
        const q = query(
            collection(db, "users", uid, "transactions"), 
            where("type", "==", "Deposit"), 
            where("status", "==", "pending")
        );
        const snap = await getDocs(q);
        snap.forEach(docSnap => {
            const tx = docSnap.data();
            if (tx.txn_id) {
                startAutoCreditCheck(tx.txn_id, docSnap.id, tx.amount, createBtn);
            }
        });
    } catch (e) {
        console.error("Pending check failed:", e);
    }
}

// --- 3. فتح لوحة السحب ---
const withdrawTrigger = document.getElementById('withdrawTrigger');
if (withdrawTrigger) {
    withdrawTrigger.onclick = async () => {
        if (!currentUserData?.securePin) {
            return Swal.fire({
                icon: 'lock',
                title: 'Security Pin Required',
                text: 'Please set your 6-digit Secure PIN in Profile first.',
                background: '#0a0f1d', color: '#fff',
                confirmButtonText: 'Go to Profile',
                showCancelButton: true
            }).then(res => { if(res.isConfirmed) window.location.href = 'profile.html'; });
        }

        try {
            const q = query(collection(db, "withdrawals"), 
                        where("uid", "==", currentUser.uid), 
                        where("status", "==", "pending"));
            const pendingSnap = await getDocs(q);

            if (!pendingSnap.empty) {
                return showError("You have an active pending withdrawal. Please wait for Admin approval.");
            }

            const availEl = document.getElementById('withdrawAvailableBalance');
            const panelEl = document.getElementById('withdrawPanel');
            const pinEl = document.getElementById('vaultPin');

            if (availEl) availEl.innerText = `Available: $${parseFloat(currentUserData.balance || 0).toFixed(2)}`;
            if (panelEl) panelEl.classList.add('show-panel');
            if (pinEl) pinEl.value = "";
        } catch (e) {
            showError("Connection error. Try again.");
        }
    };
}

// --- 4. تنفيذ عملية السحب ---
const submitWithdrawBtn = document.getElementById('submitWithdrawBtn');
if (submitWithdrawBtn) {
    submitWithdrawBtn.onclick = async () => {
        const amountInput = document.getElementById('withdrawAmount');
        const addressInput = document.getElementById('withdrawAddress');
        const pinInput = document.getElementById('vaultPin');

        const amount = parseFloat(amountInput ? amountInput.value : 0);
        const address = addressInput ? addressInput.value.trim() : "";
        const enteredPin = pinInput ? pinInput.value.trim() : "";

        if (!address || isNaN(amount) || amount < 10) return showError("Please enter a valid address and amount (Min $10).");
        if (enteredPin.length !== 6) return showError("Please enter your 6-digit Security PIN.");
        if (enteredPin !== currentUserData.securePin) return showError("Incorrect Security PIN.");
        if (amount > (currentUserData.balance || 0)) return showError("Insufficient balance in your vault.");

        try {
            submitWithdrawBtn.disabled = true;
            submitWithdrawBtn.innerText = "Verifying...";

            // خصم الرصيد فوراً وحفظ الطلب
            await updateDoc(doc(db, "users", currentUser.uid), { balance: increment(-amount) });

            const withdrawData = {
                uid: currentUser.uid,
                email: currentUser.email || "No Email",
                fullName: currentUserData.fullName || "User",
                amount: amount,
                address: address,
                status: "pending",
                type: "Withdrawal",
                timestamp: serverTimestamp()
            };

            const docRef = await addDoc(collection(db, "withdrawals"), withdrawData);
            await addDoc(collection(db, "users", currentUser.uid, "transactions"), {
                ...withdrawData,
                mainId: docRef.id 
            });

            Swal.fire({ 
                icon: 'success', 
                title: 'REQUEST SENT', 
                text: 'Your funds are locked. Admin audit in progress.', 
                background: '#0a0f1d', color: '#fff',
                confirmButtonColor: '#3b82f6'
            });

            const panelEl = document.getElementById('withdrawPanel');
            if (panelEl) panelEl.classList.remove('show-panel');
            if (pinInput) pinInput.value = "";
            if (amountInput) amountInput.value = "";
            if (addressInput) addressInput.value = "";

        } catch (e) {
            showError("System busy. Please try again later.");
        } finally {
            submitWithdrawBtn.disabled = false;
            submitWithdrawBtn.innerText = "Confirm Withdrawal";
        }
    };
}

// --- 5. تحديث سجل المعاملات ---
function loadTransactions(uid) {
    const q = query(collection(db, "users", uid, "transactions"), orderBy("timestamp", "desc"), limit(10));
    onSnapshot(q, (snap) => {
        const cont = document.getElementById('transactionHistory');
        if (!cont) return;

        cont.innerHTML = ""; 

        if (snap.empty) {
            cont.innerHTML = '<p class="text-center text-[10px] py-10 opacity-30 italic">No recent activity</p>';
            return;
        }

        snap.forEach(d => {
            const tx = d.data();
            let statusColor = "text-amber-500"; 
            if (tx.status === 'approved' || tx.status === 'completed') statusColor = "text-emerald-500";
            if (tx.status === 'rejected' || tx.status === 'failed') statusColor = "text-red-500";

            cont.innerHTML += `
                <div class="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
                    <div>
                        <span class="text-[10px] font-black uppercase text-slate-400">${tx.type}</span>
                        <p class="text-[8px] text-slate-600 font-mono">${tx.timestamp ? new Date(tx.timestamp.toDate()).toLocaleString() : 'Processing...'}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-xs font-black italic text-white">$${parseFloat(tx.amount || 0).toFixed(2)}</p>
                        <p class="text-[8px] font-black uppercase ${statusColor}">${tx.status}</p>
                    </div>
                </div>`;
        });
    });
}
