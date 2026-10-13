import assert from 'node:assert/strict';
import { calculateSmartFinancialScore, calculateLeaderboardScores, DEFAULT_LEADERBOARD_WEIGHTS } from './leaderboardGamification';

// Test 1: User's explicit prompt scenario:
// "bir satinalmaci salliyorum 100 milyon harcama yapmis bundan 6 milyon indirim almis (%6),
// diger satinalmaci 50 milyon harcama yapmis 5 milyon indirim almis (%10).
// 2. satinalmacinin puani daha yuksek olmali cunku daha az rakamdan daha cok indirim almis."
{
  const buyerA_spend = 100_000_000;
  const buyerA_savings = 6_000_000;
  const buyerA_rate = (buyerA_savings / buyerA_spend) * 100; // 6.0%

  const buyerB_spend = 50_000_000;
  const buyerB_savings = 5_000_000;
  const buyerB_rate = (buyerB_savings / buyerB_spend) * 100; // 10.0%

  const maxSavings = 6_000_000;

  const scoreA = calculateSmartFinancialScore(buyerA_savings, buyerA_rate, buyerA_spend, 20, maxSavings);
  const scoreB = calculateSmartFinancialScore(buyerB_savings, buyerB_rate, buyerB_spend, 15, maxSavings);

  console.log(`[Test 1] User Scenario - Buyer A (100M spend, 6M savings, %${buyerA_rate.toFixed(1)}): Score = ${scoreA}`);
  console.log(`[Test 1] User Scenario - Buyer B (50M spend, 5M savings, %${buyerB_rate.toFixed(1)}): Score = ${scoreB}`);

  assert.ok(
    scoreB > scoreA,
    `Buyer B (%10 from 50M) must score higher than Buyer A (%6 from 100M). Got B: ${scoreB}, A: ${scoreA}`
  );
}

// Test 2: Real Project Data - Nuri Buga (%9.54) vs Muhammed Hanci (%6.11)
{
  const nuriSavings = 5_364_011.03;
  const nuriRate = 9.54;
  const nuriSpend = 56_226_530.82;
  const nuriTxCount = 37;

  const muhammedSavings = 6_248_322.56;
  const muhammedRate = 6.11;
  const muhammedSpend = 102_263_870.76;
  const muhammedTxCount = 61;

  const maxSavings = 6_248_322.56;

  const scoreNuri = calculateSmartFinancialScore(nuriSavings, nuriRate, nuriSpend, nuriTxCount, maxSavings);
  const scoreMuhammed = calculateSmartFinancialScore(muhammedSavings, muhammedRate, muhammedSpend, muhammedTxCount, maxSavings);

  console.log(`[Test 2] Real Data - Nuri Buğa (%${nuriRate}, 5.36M savings): Score = ${scoreNuri}`);
  console.log(`[Test 2] Real Data - Muhammed Hancı (%${muhammedRate}, 6.25M savings): Score = ${scoreMuhammed}`);

  assert.ok(
    scoreNuri > scoreMuhammed,
    `Nuri Buğa (%9.54) must have a higher financial score than Muhammed Hancı (%6.11). Got Nuri: ${scoreNuri}, Muhammed: ${scoreMuhammed}`
  );
}

// Test 3: Edge cases and Credibility Protection
{
  // Zero savings
  const zeroScore = calculateSmartFinancialScore(0, 0, 1000000, 5, 5000000);
  assert.equal(zeroScore, 0, 'Zero savings should result in 0 score');

  // Single transaction anomaly: 1 invoice of 1,000 ₽ with 200 ₽ savings (%20 rate)
  // should not beat proven high-volume buyers
  const anomalyScore = calculateSmartFinancialScore(200, 20.0, 1000, 1, 6_000_000);
  const provenBuyerScore = calculateSmartFinancialScore(5_000_000, 8.0, 60_000_000, 30, 6_000_000);

  console.log(`[Test 3] Edge Case - Anomaly (1 small order %20): Score = ${anomalyScore}`);
  console.log(`[Test 3] Edge Case - Proven Buyer (30 orders %8): Score = ${provenBuyerScore}`);

  assert.ok(
    provenBuyerScore > anomalyScore,
    `Proven buyer with reliable volume should score higher than 1-off tiny order with high rate. Got Proven: ${provenBuyerScore}, Anomaly: ${anomalyScore}`
  );
}

// Test 4: User's exact prompt scenario:
// "mesela muhammed hanci %5,62, nuri buga %9,22, nurinin daha degerli olmasi gerekli cunku daha az miktardan daha cok indirim almis"
{
  const maxSavings = 6_248_322;
  const maxRate = 9.22;
  const scoreNuri = calculateSmartFinancialScore(4_500_000, 9.22, 48_800_000, 25, maxSavings, maxRate);
  const scoreMuhammed = calculateSmartFinancialScore(6_248_322, 5.62, 111_000_000, 61, maxSavings, maxRate);

  console.log(`[Test 4] User Scenario - Nuri Buğa (%9.22 rate from smaller spend): Score = ${scoreNuri}`);
  console.log(`[Test 4] User Scenario - Muhammed Hancı (%5.62 rate from larger spend): Score = ${scoreMuhammed}`);

  assert.ok(
    scoreNuri > scoreMuhammed,
    `Nuri Buğa (%9.22) must have a higher financial score than Muhammed Hancı (%5.62). Got Nuri: ${scoreNuri}, Muhammed: ${scoreMuhammed}`
  );
}

// Test 5: Full 5-Dimension Leaderboard MVP calculation & Weight Normalization
{
  const mockSupervisors = [
    { id: 'sup1', name: 'Nuri Buğa', title: 'Kıdemli Satınalma Şefi' },
    { id: 'sup2', name: 'Muhammed Hancı', title: 'Satınalma Şefi' },
    { id: 'sup3', name: 'Serkan Demirbaş', title: 'Satınalma Şefi' }
  ];

  const mockPersonnel = [
    { id: 'per1', name: 'Ahmet Uzman', supervisorId: 'sup3' },
    { id: 'per2', name: 'Mehmet Uzman', supervisorId: 'sup3' },
    { id: 'per3', name: 'Ali Uzman', supervisorId: 'sup2' }
  ];

  const mockDiscounts = [
    // Nuri: High discount rate (%12), 2 rounds negotiation, 1 new vendor, 1 goal
    {
      id: 'd1',
      supervisorId: 'sup1',
      vendorName: 'Yeni Çelik A.Ş.',
      isNewVendor: true,
      offerPrice: 10_000_000,
      agreedPrice: 8_800_000,
      discountAmount: 1_200_000, // 12%
      negotiationRounds: [{}, {}],
      status: 'Onaylandı'
    },
    // Muhammed: High volume goals (3 direct goals), 5% rate, 0 rounds, 0 new vendors
    {
      id: 'd2',
      supervisorId: 'sup2',
      vendorName: 'Eski Çimento',
      offerPrice: 20_000_000,
      agreedPrice: 19_000_000,
      discountAmount: 1_000_000, // 5%
      status: 'Onaylandı'
    },
    {
      id: 'd3',
      supervisorId: 'sup2',
      vendorName: 'Eski Çimento',
      offerPrice: 20_000_000,
      agreedPrice: 19_000_000,
      discountAmount: 1_000_000,
      status: 'Onaylandı'
    },
    {
      id: 'd4',
      supervisorId: 'sup2',
      vendorName: 'Eski Çimento',
      offerPrice: 20_000_000,
      agreedPrice: 19_000_000,
      discountAmount: 1_000_000,
      status: 'Onaylandı'
    },
    // Serkan: 2 team assists closed by his team members
    {
      id: 'd5',
      supervisorId: 'sup3',
      performedByPersonnelId: 'per1',
      vendorName: 'Mekanik Ltd',
      offerPrice: 10_000_000,
      agreedPrice: 9_200_000,
      discountAmount: 800_000,
      status: 'Onaylandı'
    },
    {
      id: 'd6',
      supervisorId: 'sup3',
      performedByPersonnelId: 'per2',
      vendorName: 'Boya Sanayi',
      offerPrice: 5_000_000,
      agreedPrice: 4_600_000,
      discountAmount: 400_000,
      status: 'Onaylandı'
    }
  ];

  const results = calculateLeaderboardScores(mockDiscounts, mockSupervisors, mockPersonnel, [], DEFAULT_LEADERBOARD_WEIGHTS, 'MVP');
  console.log(`[Test 5] Leaderboard Results (${results.length} supervisors):`);
  results.forEach(p => {
    console.log(`  #${p.mvpRank} ${p.supervisorName}: MVP ${p.mvpScore} | Fin: ${p.normalizedScores.financialScore} | Goals: ${p.normalizedScores.goalsScore} | Rounds: ${p.normalizedScores.roundsScore} | Assists: ${p.normalizedScores.assistsScore} | Network: ${p.normalizedScores.networkScore}`);
  });

  assert.equal(results.length, 3);
  assert.equal(results[0].supervisorName, 'Nuri Buğa', 'Nuri must rank #1 due to highest rate %12, rounds, and new vendor');
  assert.ok(results[0].normalizedScores.financialScore > results[1].normalizedScores.financialScore, 'Nuri (%12 rate) must score higher in financial verimlilik than Muhammed (%5 rate)');
  assert.equal(results[0].normalizedScores.networkScore, 100, 'Nuri must have 100 network expansion score');
  assert.equal(results[0].normalizedScores.roundsScore, 100, 'Nuri must have 100 negotiation rounds score');

  // Verify Serkan dominates assists
  const serkan = results.find(p => p.supervisorName === 'Serkan Demirbaş')!;
  assert.equal(serkan.normalizedScores.assistsScore, 100, 'Serkan must have 100 assists score');

  // Verify Muhammed dominates goals
  const muhammed = results.find(p => p.supervisorName === 'Muhammed Hancı')!;
  assert.equal(muhammed.normalizedScores.goalsScore, 100, 'Muhammed must have 100 goals score');
}

// Test 6: User's exact complaint scenario:
// "halil az indirim almis osman daha cok almis ekip asisti daha cok fakat son sirada olmasi kotu olmus biraz adeletli olmali"
// Osman: 2.88M savings, 6 goals, 27 assists, 33 transactions (%5.58 rate)
// Halil: 1.51M savings, 1 goal, 9 assists, 10 transactions (%10.44 rate)
// Osman MUST rank above Halil in overall MVP because of 3x more assists, 6x more goals, and 2x more savings.
{
  const mockSupervisors = [
    { id: 'sup_osman', name: 'Osman Yılmaz', title: 'Satınalma Şefi' },
    { id: 'sup_halil', name: 'Halil İbrahim Zengin', title: 'Satınalma Şefi' }
  ];

  const mockPersonnel = [
    { id: 'per_osman', name: 'Gleb Yudin', supervisorId: 'sup_osman' },
    { id: 'per_halil', name: 'Yuliya Krivova', supervisorId: 'sup_halil' }
  ];

  const mockDiscounts: any[] = [];
  // Osman: 6 goals + 27 assists
  for (let i = 0; i < 6; i++) {
    mockDiscounts.push({
      id: `osman_goal_${i}`,
      supervisorId: 'sup_osman',
      vendorName: 'Vendor O',
      offerPrice: 2_000_000,
      agreedPrice: 1_880_000,
      discountAmount: 120_000,
      status: 'Onaylandı'
    });
  }
  for (let i = 0; i < 27; i++) {
    mockDiscounts.push({
      id: `osman_ast_${i}`,
      supervisorId: 'sup_osman',
      performedByPersonnelId: 'per_osman',
      vendorName: 'Vendor O',
      offerPrice: 1_500_000,
      agreedPrice: 1_420_000,
      discountAmount: 80_000,
      status: 'Onaylandı'
    });
  }

  // Halil: 1 goal + 9 assists (high rate %10.44)
  mockDiscounts.push({
    id: 'halil_goal_0',
    supervisorId: 'sup_halil',
    vendorName: 'Vendor H',
    offerPrice: 2_000_000,
    agreedPrice: 1_790_000,
    discountAmount: 210_000,
    status: 'Onaylandı'
  });
  for (let i = 0; i < 9; i++) {
    mockDiscounts.push({
      id: `halil_ast_${i}`,
      supervisorId: 'sup_halil',
      performedByPersonnelId: 'per_halil',
      vendorName: 'Vendor H',
      offerPrice: 1_400_000,
      agreedPrice: 1_255_000,
      discountAmount: 145_000,
      status: 'Onaylandı'
    });
  }

  const results = calculateLeaderboardScores(mockDiscounts, mockSupervisors, mockPersonnel, [], DEFAULT_LEADERBOARD_WEIGHTS, 'MVP');
  console.log(`[Test 6] Osman vs Halil Leaderboard:`);
  results.forEach(p => {
    console.log(`  #${p.mvpRank} ${p.supervisorName}: MVP ${p.mvpScore} | Goals: ${p.rawMetrics.directGoalsCount} | Assists: ${p.rawMetrics.teamAssistsCount} | Fin: ${p.normalizedScores.financialScore} (%${p.rawMetrics.savingsRatePct}) | Savings: ${p.rawMetrics.totalSavings}`);
  });

  assert.equal(results[0].supervisorName, 'Osman Yılmaz', 'Osman must rank #1 over Halil due to 3x more assists and 6x more goals');
  assert.equal(results[1].supervisorName, 'Halil İbrahim Zengin', 'Halil must rank #2');
  assert.ok(results[0].mvpScore > results[1].mvpScore, 'Osman MVP score must be strictly higher than Halil MVP score');
}

console.log('All leaderboardGamification test assertions passed successfully.');
