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

// ⚠️ مفتاح Plisio API الخاص بك لتوليد الفاتورة ومتابعتها تلقائياً
const PLISIO_API_KEY = "Q4bxjujHY_e8X60i3CHtg-yj3Ivyz2OGqx9WTr1bBrvQx0bEHT40Mt2PHsZ57lsa";

let currentUser = null;
let currentUserData = null;

// --- دالة إظهار الخطأ ---
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
                document.getElementById('userBalance').innerText = `$${parseFloat(currentUserData.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
                document.getElementById('userName').innerText = currentUserData.fullName || "User";
                document.getElementById('userTier').innerText = currentUserData.tier || "Tier 1";
            }
        });
        loadTransactions(user.uid);
        checkPendingDeposits(user.uid); // فحص أي إيداع معلق عند فتح الصفحة
    } else {
        window.location.href = 'login.html';
    }
});

// --- 2. إنشاء الفاتورة ديناميكياً والتوجيه للدفع + التتبع التلقائي للرصيد ---
document.getElementById('createInvoiceBtn').onclick = async () => {
    const btn = document.getElementById('createInvoiceBtn');
    const amountInput = document.getElementById('depositAmountInput');
    const amount = parseFloat(amountInput.value);

    if (!currentUser) return showError("Please login to proceed.");
    if (isNaN(amount) || amount <= 0) return showError("Please enter a valid amount.");

    try {
        btn.disabled = true;
        btn.innerText = "Creating Invoice...";

        const orderNumber = `DEP_${currentUser.uid.substring(0, 5)}_${Date.now()}`;

        // طلب إنشاء فاتورة حقيقية من Plisio لتحديد المبلغ بدقة
        const response = await fetch(`https://plisio.net/api/v1/invoices/new?api_key=${PLISIO_API_KEY}&source_currency=USD&source_amount=${amount}&order_number=${orderNumber}&currency=USDT_BSC`);
        const data = await response.json();

        if (data.status === "success") {
            const invoiceData = data.data;

            // تسجيل المعاملة كـ pending مع الـ txn_id الخاص بـ Plisio
            const txRef = await addDoc(collection(db, "users", currentUser.uid, "transactions"), {
                uid: currentUser.uid,
                amount: amount,
                type: "Deposit",
                status: "pending",
                txn_id: invoiceData.txn_id,
                orderNumber: orderNumber,
                timestamp: serverTimestamp()
            });

            // فتح صفحة الدفع الخاصة بالعملية
            window.open(invoiceData.invoice_url, '_blank');

            btn.innerText = "Awaiting Payment...";

            // بدء التحقق اللحظي لزيادة الرصيد تلقائياً بمجرد الدفع
            startAutoCreditCheck(invoiceData.txn_id, txRef.id, amount, btn);

        } else {
            showError("Failed to generate invoice. Check Plisio API Key.");
            btn.disabled = false;
            btn.innerText = "Pay with Crypto (Plisio)";
        }

    } catch (error) {
        console.error("Invoice Error:", error);
        showError("Unexpected error. Please try again.");
        btn.disabled = false;
        btn.innerText = "Pay with Crypto (Plisio)";
    }
};

// --- دالة الفحص التلقائي لزيادة الرصيد ---
function startAutoCreditCheck(txnId, txDocId, amount, btn) {
    const checkInterval = setInterval(async () => {
        try {
            const res = await fetch(`https://plisio.net/api/v1/operations/${txnId}?api_key=${PLISIO_API_KEY}`);
            const result = await res.json();

            if (result.status === "success" && (result.data.status === "completed" || result.data.status === "mismatch")) {
                clearInterval(checkInterval);

                // زيادة رصيد المستخدم طبيعياً وفورياً في قاعدة البيانات
                await updateDoc(doc(db, "users", currentUser.uid), { 
                    balance: increment(amount) 
                });

                // تحديث حالة المعاملة إلى مكتملة
                await updateDoc(doc(db, "users", currentUser.uid, "transactions", txDocId), { 
                    status: "completed" 
                });

                Swal.fire({
                    icon: 'success',
                    title: 'DEPOSIT SUCCESSFUL',
                    text: `$${amount} has been added to your balance successfully!`,
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

// --- فحص الإيداعات المعلقة القديمة عند إعادة تحميل الصفحة ---
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
                startAutoCreditCheck(tx.txn_id, docSnap.id, tx.amount, document.getElementById('createInvoiceBtn'));
            }
        });
    } catch (e) {
        console.error("Pending check failed:", e);
    }
}

// --- 3. فتح لوحة السحب ---
document.getElementById('withdrawTrigger').onclick = async () => {
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

        document.getElementById('withdrawAvailableBalance').innerText = `Available: $${parseFloat(currentUserData.balance || 0).toFixed(2)}`;
        document.getElementById('withdrawPanel').classList.add('show-panel');
        document.getElementById('vaultPin').value = "";
    } catch (e) {
        showError("Connection error. Try again.");
    }
};

// --- 4. تنفيذ عملية السحب ---
document.getElementById('submitWithdrawBtn').onclick = async () => {
    const btn = document.getElementById('submitWithdrawBtn');
    const amount = parseFloat(document.getElementById('withdrawAmount').value);
    const address = document.getElementById('withdrawAddress').value.trim();
    const enteredPin = document.getElementById('vaultPin').value.trim();

    if (!address || isNaN(amount) || amount < 10) return showError("Please enter a valid address and amount (Min $10).");
    if (enteredPin.length !== 6) return showError("Please enter your 6-digit Security PIN.");
    if (enteredPin !== currentUserData.securePin) return showError("Incorrect Security PIN.");
    if (amount > (currentUserData.balance || 0)) return showError("Insufficient balance in your vault.");

    try {
        btn.disabled = true;
        btn.innerText = "Verifying...";

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

        document.getElementById('withdrawPanel').classList.remove('show-panel');
        document.getElementById('vaultPin').value = "";
        document.getElementById('withdrawAmount').value = "";
        document.getElementById('withdrawAddress').value = "";

    } catch (e) {
        showError("System busy. Please try again later.");
    } finally {
        btn.disabled = false;
        btn.innerText = "Confirm Withdrawal";
    }
};

// --- 5. تحديث سجل المعاملات ---
function loadTransactions(uid) {
    const q = query(collection(db, "users", uid, "transactions"), orderBy("timestamp", "desc"), limit(10));
    onSnapshot(q, (snap) => {
        const cont = document.getElementById('transactionHistory');
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
