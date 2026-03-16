const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const { FieldValue } = admin.firestore;

function getUkDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function calculateDailyROI(balance) {
  if (balance >= 15000) return balance * 0.035;
  if (balance >= 5000) return balance * 0.03;
  if (balance >= 2000) return balance * 0.025;
  if (balance >= 500) return balance * 0.022;
  if (balance >= 50) return balance * 0.019;
  return 0;
}

function isRewardEligible(balance) {
  return Number(balance || 0) >= 100;
}

exports.runDailyExecution = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    const uid = request.auth.uid;
    const userRef = db.collection("users").doc(uid);

    const result = await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);

      if (!userSnap.exists) {
        throw new HttpsError("not-found", "User record not found.");
      }

      const userData = userSnap.data() || {};
      const balance = Number(userData.balance || 0);

      if (balance < 50) {
        throw new HttpsError("failed-precondition", "Minimum $50 required.");
      }

      const now = new Date();
      const ukHour = Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/London",
          hour: "numeric",
          hour12: false,
        }).format(now)
      );

      const currentKey = getUkDateKey(now);

      if (userData.lastExecution?.toDate) {
        const lastKey = getUkDateKey(userData.lastExecution.toDate());
        if (lastKey === currentKey || ukHour < 1) {
          throw new HttpsError("already-exists", "Daily execution already completed.");
        }
      } else if (ukHour < 1) {
        throw new HttpsError("failed-precondition", "Execution is not open yet.");
      }

      const personalProfit = calculateDailyROI(balance);

      tx.update(userRef, {
        balance: FieldValue.increment(personalProfit),
        dailyEarn: personalProfit,
        totalEarned: FieldValue.increment(personalProfit),
        lastExecution: admin.firestore.Timestamp.now(),
      });

      return {
        personalProfit,
        inviteCode: userData.inviteCode || null,
        childBalance: balance,
      };
    });

    if (result.inviteCode && isRewardEligible(result.childBalance)) {
      const generationPercents = [0.10, 0.075, 0.04];
      let currentCode = result.inviteCode;

      for (let i = 0; i < generationPercents.length; i++) {
        if (!currentCode) break;

        const qSnap = await db
          .collection("users")
          .where("referralId", "==", currentCode)
          .limit(1)
          .get();

        if (qSnap.empty) break;

        const receiverDoc = qSnap.docs[0];
        const receiverData = receiverDoc.data() || {};
        const receiverBalance = Number(receiverData.balance || 0);

        if (isRewardEligible(receiverBalance)) {
          const reward = result.personalProfit * generationPercents[i];

          await receiverDoc.ref.update({
            balance: FieldValue.increment(reward),
            teamEarn: FieldValue.increment(reward),
            totalTeamEarned: FieldValue.increment(reward),
          });
        }

        currentCode = receiverData.inviteCode || null;
      }
    }

    return {
      success: true,
      personalProfit: result.personalProfit,
    };
  }
);
