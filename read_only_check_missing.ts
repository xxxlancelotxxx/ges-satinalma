import { getStorage } from "firebase-admin/storage";
import admin from "firebase-admin";

admin.initializeApp();

async function run() {
  const bucketGoodName = "ai-studio-bucket-88134939798-europe-west2";
  const bucketBadName = "fatura-botu-505106.firebasestorage.app";
  const bucketGood = getStorage().bucket(bucketGoodName);
  const bucketBad = getStorage().bucket(bucketBadName);

  const missingFiles = [
    "14dfae9f0cb3e35f414d20aa193d989adb3277e44a64e361dc71da97c4a90cdc.pdf",
    "05cef47857946ed837d00cd76fa9e9ba5790d6ad223155216d347ee21f7725ce.pdf",
    "43dd854f8e19a835301aeb8cb59e2824707473df07713e62975877f24cbb9821.pdf",
    "85c51d2e975fcfbd31b820ce9b6356d495c50690eaef4f673194654982d0a3bc.pdf",
    "814de00c8f9396e8463d4c27f26bde185b9d559a0e9afc1c0641f47e0026a38e.pdf",
    "76fd34ddb27f17cfab060f5d63c99601d27903f3041938e1d66bfa2e723eb759.pdf",
    "f9ee7f9ee5c722832cf3918747d5851d19ece6e877186bcfc3caafed314e0802.pdf",
    "dc21a799698fa26a078893c06409f35ab4058a39e454e3af25c32eb57c36ed93.pdf",
    "456692eeb1ed4ae62423cd5878873663fac612e66864c856f69946d3396689e6.pdf",
    "81e5e4fe8b794e167139910974d2e7e444446c6643adc5ca4298a06d676fd5ac.pdf"
  ];

  const report: any = {};
  for(const f of missingFiles) {
     let gExists = false;
     let bExists = false;
     let bError = "";
     try { gExists = (await bucketGood.file("faturalar/" + f).exists())[0]; } catch(e){}
     try { bExists = (await bucketBad.file("faturalar/" + f).exists())[0]; } catch(e:any){ bError = e.message; }
     report[f] = { goodBucket: gExists, badBucket: bExists, badBucketError: bError };
  }
  console.log(JSON.stringify(report, null, 2));
}

run();
