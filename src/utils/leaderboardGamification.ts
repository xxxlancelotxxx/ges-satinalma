import * as XLSX from 'xlsx';
import { formatRuble } from './format';
const ua = formatRuble;

/* AUTO-PORTED from the live production bundle (gescons.ai.studio, build 2026-09-13T23:30Z). */

const EP=["İnşaat Demiri & Çelik","Hazır Beton & Çimento","Kalıp & İskele Sistemleri","Elektrik & Otomasyon","Mekanik & Tesisat","Yalıtım & Alçıpan","Seramik & Vitrifiye","Boya & Dış Cephe","Yapı Kimyasalları","Sarf Malzeme & Hırdavat","Ofis & Kırtasiye","Bilgi İşlem & IT","Hizmet & Lojistik","Diğer Malzeme"];
const gY=new Set(["diğer malzeme","diğer","diger","genel malzeme","genel","malzeme","inşaat malzemesi","insaat malzemesi","muhtelif","other","general","uncategorized","bilinmeyen",""]);
const AY=["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
const mI = {
  individualGoals: 0.25,    // %25 Bireysel GOL Krallığı (Şahsen masada kazanılan doğrudan indirimler)
  teamAssists: 0.20,        // %20 Ekip Asistleri & Liderlik (Ekip uzmanlarının indirimlerine rehberlik ve asist hacmi)
  financialSavings: 0.25,   // %25 İndirim Oranı & Finansal Verimlilik (İskonto %60, Hacim %25, İstikrar %15)
  negotiationRounds: 0.15,  // %15 Müzakere Turları & Azim (Çok turlu çetin pazarlıklar)
  networkExpansion: 0.15,   // %15 Yeni Tedarikçi Kazandırma (Alternatif tedarikçi portföyü & tekel kırma)
};


export type LeaderboardCategory = string;

export interface LeaderboardWeightConfig {
  financialSavings: number;
  individualGoals: number;
  negotiationRounds: number;
  teamAssists: number;
  networkExpansion?: number;
  negotiationBreadth?: number;
}

export const DEFAULT_LEADERBOARD_WEIGHTS: LeaderboardWeightConfig = mI as LeaderboardWeightConfig;

export interface SupervisorGamificationProfile {
  supervisorId: string;
  supervisorName: string;
  title: string;
  department: string;
  initials: string;
  teamSize: number;
  mvpRank: number;
  mvpScore: number;
  categoryScore: number;
  categoryRank: number;
  categoryDisplayValue: string;
  rawMetrics: {
    totalSavings: number;
    totalListPrice: number;
    totalSpend: number;
    savingsRatePct: number;
    totalTransactions: number;
    directGoalsCount: number;
    directGoalsSavings: number;
    totalNegotiationRounds: number;
    negotiatedDealsCount: number;
    avgNegotiationRounds: number;
    multiRoundDealsCount: number;
    teamAssistsCount: number;
    teamAssistsSavings: number;
    newVendorsCount: number;
    newVendorNames: string[];
  };
  normalizedScores: {
    financialScore: number;
    goalsScore: number;
    roundsScore: number;
    assistsScore: number;
    networkScore: number;
    transactionScore?: number;
  };
  flagshipDeals: any[];
  teamMembers: any[];
}

export function calculateLeaderboardScores(
  discounts: any[] = [],
  supervisors: any[] = [],
  personnel: any[] = [],
  invoices: any[] = [],
  weights: LeaderboardWeightConfig = DEFAULT_LEADERBOARD_WEIGHTS,
  activeCategory: LeaderboardCategory = 'MVP'
): SupervisorGamificationProfile[] {
  return pI(discounts, supervisors, personnel, invoices, weights, activeCategory) as SupervisorGamificationProfile[];
}

function j0(e: any ): any {return e?gY.has(e.toLowerCase().trim()):!0}
function KN(e: any ): any {if(!e)return"Diğer Malzeme";const t=e.trim(),a=t.toLowerCase();if(a.includes("demir")||a.includes("çelik")||a.includes("rebar")||a.includes("hadde")||a.includes("metal"))return"İnşaat Demiri & Çelik";if(a.includes("beton")||a.includes("çimento")||a.includes("agrega")||a.includes("keramzit"))return"Hazır Beton & Çimento";if(a.includes("kalıp")||a.includes("kalip")||a.includes("iskele")||a.includes("plywood")||a.includes("kontrplak")||a.includes("kereste"))return"Kalıp & İskele Sistemleri";if(a.includes("elektrik")||a.includes("otomasyon")||a.includes("kablo")||a.includes("pano"))return"Elektrik & Otomasyon";if(a.includes("mekanik")||a.includes("tesisat")||a.includes("havalandırma")||a.includes("klima")||a.includes("sıhhi"))return"Mekanik & Tesisat";if(a.includes("yalıtım")||a.includes("yalitim")||a.includes("alçıpan")||a.includes("alcipan")||a.includes("strafor")||a.includes("taşyünü"))return"Yalıtım & Alçıpan";if(a.includes("seramik")||a.includes("fayans")||a.includes("vitrifiye")||a.includes("granit"))return"Seramik & Vitrifiye";if(a.includes("boya")||a.includes("cephe")||a.includes("astar"))return"Boya & Dış Cephe";if(a.includes("kimyasal")||a.includes("harç")||a.includes("epoksi")||a.includes("mastik"))return"Yapı Kimyasalları";if(a.includes("hırdavat")||a.includes("hirdavat")||a.includes("sarf")||a.includes("civata")||a.includes("bağlantı"))return"Sarf Malzeme & Hırdavat";if(a.includes("ofis")||a.includes("kırtasiye")||a.includes("kirtasiye")||a.includes("gıda")||a.includes("temizlik")||a.includes("çay")||a.includes("şeker"))return"Ofis & Kırtasiye";if(a.includes("bilgi işlem")||a.includes("it")||a.includes("bilgisayar")||a.includes("donanım"))return"Bilgi İşlem & IT";if(a.includes("hizmet")||a.includes("lojistik")||a.includes("nakliye")||a.includes("taşıma")||a.includes("kiralama"))return"Hizmet & Lojistik";const i=EP.find(r=>r.toLowerCase()===a);return i||t}
function _s(e: any ,t: any ,a: any ,i: any ): any {if(i&&!j0(i))return i.trim();const r=`${e||""} ${t||""} ${a||""}`.toLowerCase();return r.includes("арматур")||r.includes("пруток")||r.includes("сталь")||r.includes("уголок")||r.includes("швеллер")||r.includes("балка")||r.includes("труба 80х80")||r.includes("труба 60х40")||r.includes("труба профильн")||r.includes("лист г/к")||r.includes("лист х/к")||r.includes("лист горячекатан")||r.includes("металлопрокат")||r.includes("сетка кладочная")||r.includes("муфта")||r.includes("закладная")||r.includes("катанка")||r.includes("двутавр")||r.includes("металл-инвест")||r.includes("металл")||r.includes("тесса")||r.includes("каркас кр")||r.includes("a500c")||r.includes("а500с")||r.includes("inşaat demiri")||r.includes("nervürlü demir")||r.includes("hasır çelik")||r.includes("kutu profil")||r.includes("çelik sac")||r.includes("karkas kr")||r.includes("donatı manşonu")||r.includes("hadde profil")?"İnşaat Demiri & Çelik":r.includes("опалубк")||r.includes("леса")||r.includes("фанер")||r.includes("доска обрезн")||r.includes("доска 50х")||r.includes("доска 30х")||r.includes("доска 25х")||r.includes("брус 100х100")||r.includes("брус 50х100")||r.includes("брус")||r.includes("стойка телескопическ")||r.includes("балка бдк")||r.includes("унивилка")||r.includes("тренога")||r.includes("стяжка")||r.includes("гайка опалубки")||r.includes("горизонтальный элемент")||r.includes("вертикальный элемент")||r.includes("вставка соединительная")||r.includes("baumak")||r.includes("колорадо")||r.includes("гк атмос")||r.includes("атмос")||r.includes("щит опалубки")||r.includes("ламинированная фанера")||r.includes("блок-контейнер")||r.includes("контейнер 5,85")||r.includes("трейдми")||r.includes("kalıp")||r.includes("iskele")||r.includes("plywood")||r.includes("kontrplak")||r.includes("kereste")||r.includes("tahta")||r.includes("teleskopik dikme")||r.includes("tie-rod")||r.includes("çiroz")?"Kalıp & İskele Sistemleri":r.includes("бетон")||r.includes("цемент")||r.includes("раствор")||r.includes("пескобетон")||r.includes("керамзит")||r.includes("щебень")||r.includes("песок")||r.includes("гравий")||r.includes("цпс")||r.includes("тск дипломат")||r.includes("дипломат")||r.includes("b25")||r.includes("b30")||r.includes("b35")||r.includes("b20")||r.includes("m100")||r.includes("m150")||r.includes("m200")||r.includes("m300")||r.includes("m350")||r.includes("m400")||r.includes("hazır beton")||r.includes("çimento")||r.includes("grobeton")||r.includes("şap kumu")||r.includes("agrega")?"Hazır Beton & Çimento":r.includes("дюбель для теплоизоляци")||r.includes("гвоздь c термоголовкой")||r.includes("bogirus")||r.includes("технорум")||r.includes("минвата")||r.includes("каменная вата")||r.includes("пеноплэкс")||r.includes("пенопласт")||r.includes("гипсокартон")||r.includes("гкл")||r.includes("гклв")||r.includes("профиль для гкл")||r.includes("мембрана")||r.includes("рубероид")||r.includes("технониколь")||r.includes("кнауф")||r.includes("knauf")||r.includes("rockwool")||r.includes("утеплитель")||r.includes("taşyünü")||r.includes("alçıpan")||r.includes("ısı yalıtım")||r.includes("strafor")?"Yalıtım & Alçıpan":r.includes("комус")||r.includes("komus")||r.includes("attache")||r.includes("салфет")||r.includes("салфетница")||r.includes("помпа механическая")||r.includes("деловой стандарт")||r.includes("ahmad")||r.includes("чай")||r.includes("сахар")||r.includes("тарелка одноразов")||r.includes("посуда одноразов")||r.includes("бумага а4")||r.includes("бумага")||r.includes("тетрадь")||r.includes("папка")||r.includes("ручка")||r.includes("файлы")||r.includes("контейнер пэт")||r.includes("делопроизводств")||r.includes("kırtasiye")||r.includes("peçetelik")||r.includes("damacana pompası")||r.includes("çay")||r.includes("şeker")||r.includes("tek kullanımlık tabak")?"Ofis & Kırtasiye":r.includes("мешки для мусора")||r.includes("швабр")||r.includes("насадка моп")||r.includes("de'longhi")||r.includes("шайба круглая")||r.includes("саморез")||r.includes("болт")||r.includes("гайка")||r.includes("диск отрезной")||r.includes("сверло")||r.includes("перчатки")||r.includes("стретч")||r.includes("скотч")||r.includes("крепеж")||r.includes("инструмент")||r.includes("çöp torbası")||r.includes("mop başlığı")||r.includes("çatı pulu")||r.includes("kesici disk")||r.includes("civata")||r.includes("hırdavat")?"Sarf Malzeme & Hırdavat":r.includes("кабель")||r.includes("провод")||r.includes("ввгнг")||r.includes("ввг")||r.includes("автомат")||r.includes("щит электрическ")||r.includes("трансформатор")||r.includes("светильник")||r.includes("лампа")||r.includes("розетка")||r.includes("выключатель")||r.includes("гофра")||r.includes("лоток кабельн")||r.includes("kablo")||r.includes("elektrik")||r.includes("aydınlatma")||r.includes("sigorta panosu")?"Elektrik & Otomasyon":r.includes("труба пнд")||r.includes("труба пвх")||r.includes("труба полипропилен")||r.includes("вентиляци")||r.includes("насос")||r.includes("клапан")||r.includes("задвижка")||r.includes("радиатор")||r.includes("котел")||r.includes("фитинг")||r.includes("фланец")||r.includes("кран шаров")||r.includes("спринклер")||r.includes("канализаци")||r.includes("водопровод")||r.includes("tesisat")||r.includes("vana")||r.includes("havalandırma")||r.includes("su borusu")?"Mekanik & Tesisat":r.includes("керамогранит")||r.includes("плитка")||r.includes("унитаз")||r.includes("раковина")||r.includes("смеситель")||r.includes("ванна")||r.includes("санфаянс")||r.includes("затирка")||r.includes("seramik")||r.includes("fayans")||r.includes("vitrifiye")||r.includes("lavabo")?"Seramik & Vitrifiye":r.includes("краска")||r.includes("грунтовка")||r.includes("шпатлевка")||r.includes("шпаклевка")||r.includes("эмаль")||r.includes("лак")||r.includes("колер")||r.includes("фасад")||r.includes("сайдинг")||r.includes("tikkurila")||r.includes("boya")||r.includes("dış cephe")||r.includes("astar")?"Boya & Dış Cephe":r.includes("герметик")||r.includes("клей плиточн")||r.includes("пена монтажная")||r.includes("добавка в бетон")||r.includes("пластификатор")||r.includes("гидроизоляционн")||r.includes("праймер")||r.includes("эпоксид")||r.includes("мастика")||r.includes("sika")||r.includes("ceresit")||r.includes("yapı kimyasal")||r.includes("montaj köpüğü")||r.includes("su yalıtım kimyasal")?"Yapı Kimyasalları":r.includes("организация доставки")||r.includes("доставка")||r.includes("транспортные услуги")||r.includes("услуги погрузк")||r.includes("разгрузка")||r.includes("аренда крана")||r.includes("аренда техники")||r.includes("перевозка")||r.includes("экспедирование")||r.includes("nakliye")||r.includes("lojistik")||r.includes("taşıma")||r.includes("teslimat hizmeti")?"Hizmet & Lojistik":r.includes("ноутбук")||r.includes("компьютер")||r.includes("монитор")||r.includes("сервер")||r.includes("принтер")||r.includes("картридж")||r.includes("тонер")||r.includes("роутер")||r.includes("bilgisayar")||r.includes("laptop")||r.includes("yazıcı")||r.includes("toner")?"Bilgi İşlem & IT":"Diğer Malzeme"}
function ps(e: any ): any {const t=e.supplier||e.vendorName||"",a=Array.isArray(e.items)?e.items:[];if(a.length>0){const r=new Map,n=new Map;a.forEach(c=>{const f=_s(c.materialName,c.originalName,t,c.category),m=Number(c.totalPrice)||Number(c.unitPrice)*Number(c.quantity)||1;r.set(f,(r.get(f)||0)+m),n.set(f,(n.get(f)||0)+1)});const o=Array.from(r.entries()).filter(([c])=>c!=="Diğer Malzeme"&&c!=="Hizmet & Lojistik");if(o.length>0)return o.sort((c,f)=>f[1]-c[1]),o[0][0];const u=Array.from(r.entries()).filter(([c])=>c!=="Diğer Malzeme");if(u.length>0)return u.sort((c,f)=>f[1]-c[1]),u[0][0]}if(e.category&&!j0(e.category))return e.category.trim();const i=_s(e.notes,"",t,null);return i!=="Diğer Malzeme"?i:"Diğer Malzeme"}
function hs(e: any ): any {if(!e)return null;const t=String(e).trim();if(!t)return null;const a=t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);if(a){const n=parseInt(a[1],10),o=parseInt(a[2],10)-1,u=parseInt(a[3],10),c=new Date(u,o,n);if(!isNaN(c.getTime()))return c}const i=t.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);if(i){const n=parseInt(i[1],10),o=parseInt(i[2],10)-1,u=parseInt(i[3],10),c=new Date(n,o,u);if(!isNaN(c.getTime()))return c}const r=new Date(t);return isNaN(r.getTime())?null:r}
function qN(e: any ): any {const t=hs(e);if(!t)return null;const a=t.getFullYear(),i=String(t.getMonth()+1).padStart(2,"0");return`${a}-${i}`}
function pg(e: any ,t: any ,a: any ): any {const i=new Date,r=new Date(i.getFullYear(),i.getMonth(),i.getDate(),23,59,59,999);let n;switch(e){case"THIS_MONTH":n=new Date(i.getFullYear(),i.getMonth(),1,0,0,0,0);break;case"LAST_3_MONTHS":n=new Date(i.getFullYear(),i.getMonth()-2,1,0,0,0,0);break;case"LAST_12_MONTHS":n=new Date(i.getFullYear(),i.getMonth()-11,1,0,0,0,0);break;case"CUSTOM":if(t){const o=hs(t);n=o?new Date(o.getFullYear(),o.getMonth(),o.getDate(),0,0,0,0):new Date(2e3,0,1)}else n=new Date(i.getFullYear(),i.getMonth()-11,1);if(a){const o=hs(a);if(o)return{start:n,end:new Date(o.getFullYear(),o.getMonth(),o.getDate(),23,59,59,999)}}break;case"ALL_TIME":default:n=new Date(2e3,0,1,0,0,0,0);break}return{start:n,end:r}}
function xY(e: any ,t: any ,a: any ): any {const i=a.getTime()-t.getTime(),r=new Date(t.getTime()-1);return{start:new Date(r.getTime()-i),end:r}}
function Wo(e: any ,t: any ): any {if(!e||!t)return!1;const a=e.trim().toLowerCase(),i=t.trim().toLowerCase();return a===i||KN(e).toLowerCase()===KN(t).toLowerCase()}
function UN(e: any ,t: any ,a: any ): any {if(!Array.isArray(e))return[];const i=a||pg(t.dateRange,t.customStartDate,t.customEndDate);return e.filter(r=>{if(r.isDeleted||r.test===true||(!r.jobsiteName&&!r.jobsiteId&&!r.supplier&&!r.totalAmount&&(!r.items||r.items.length===0)))return!1;if(r.date){const n=hs(r.date);if(n&&(n<i.start||n>i.end))return!1}if(t.selectedJobsiteId&&t.selectedJobsiteId!=="ALL"&&r.jobsiteId!==t.selectedJobsiteId||t.selectedSupervisorId&&t.selectedSupervisorId!=="ALL"&&r.uploadedBySupervisorId!==t.selectedSupervisorId)return!1;if(t.selectedCategory&&t.selectedCategory!=="ALL"){const n=t.selectedCategory,o=ps({supplier:r.supplier,notes:r.notes,items:r.items}),u=Wo(o,n),c=Array.isArray(r.items)&&r.items.some(f=>Wo(f.category,n)||Wo(_s(f.materialName,f.originalName,r.supplier,f.category),n));if(!u&&!c)return!1}if(t.searchTerm&&t.searchTerm.trim()!==""){const n=t.searchTerm.toLowerCase().trim(),o=r.supplier&&r.supplier.toLowerCase().includes(n),u=r.invoiceNumber&&r.invoiceNumber.toLowerCase().includes(n),c=r.jobsiteName&&r.jobsiteName.toLowerCase().includes(n),f=r.uploadedBySupervisorName&&r.uploadedBySupervisorName.toLowerCase().includes(n),m=Array.isArray(r.items)&&r.items.some(p=>p.materialName&&p.materialName.toLowerCase().includes(n)||p.originalName&&p.originalName.toLowerCase().includes(n));if(!o&&!u&&!c&&!f&&!m)return!1}return!0})}
function HN(e: any ,t: any ,a: any ): any {if(!Array.isArray(e))return[];const i=a||pg(t.dateRange,t.customStartDate,t.customEndDate);return e.filter(r=>{if(r.orderDate){const n=hs(r.orderDate);if(n&&(n<i.start||n>i.end))return!1}if(t.selectedJobsiteId&&t.selectedJobsiteId!=="ALL"&&r.jobsiteId!==t.selectedJobsiteId||t.selectedSupervisorId&&t.selectedSupervisorId!=="ALL"&&r.supervisorId!==t.selectedSupervisorId)return!1;if(t.selectedCategory&&t.selectedCategory!=="ALL"){const n=t.selectedCategory,o=ps({category:r.category,vendorName:r.vendorName,notes:r.notes,items:r.items}),u=Wo(r.category,n)||Wo(o,n),c=Array.isArray(r.items)&&r.items.some(f=>Wo(f.category,n)||Wo(_s(f.materialName,f.originalName,r.vendorName,f.category),n));if(!u&&!c)return!1}if(t.searchTerm&&t.searchTerm.trim()!==""){const n=t.searchTerm.toLowerCase().trim(),o=r.vendorName&&r.vendorName.toLowerCase().includes(n),u=r.jobsiteName&&r.jobsiteName.toLowerCase().includes(n),c=r.supervisorName&&r.supervisorName.toLowerCase().includes(n),f=r.notes&&r.notes.toLowerCase().includes(n),m=Array.isArray(r.items)&&r.items.some(p=>p.materialName&&p.materialName.toLowerCase().includes(n)||p.originalName&&p.originalName.toLowerCase().includes(n));if(!o&&!u&&!c&&!f&&!m)return!1}return!0})}
function GN(e: any ,t: any ): any {return t===0?e>0?100:0:Number(((e-t)/t*100).toFixed(1))}
function NY(e: any ,t: any ): any {const a=new Set;Array.isArray(e)&&e.forEach(r=>{if(r.isDeleted)return;const n=ps({supplier:r.supplier,notes:r.notes,items:r.items});n&&!j0(n)&&a.add(n),Array.isArray(r.items)&&r.items.forEach(o=>{const u=_s(o.materialName,o.originalName,r.supplier,o.category);u&&!j0(u)&&a.add(u)})}),Array.isArray(t)&&t.forEach(r=>{if(r.isDeleted)return;const n=ps({category:r.category,vendorName:r.vendorName,notes:r.notes,items:r.items});n&&!j0(n)&&a.add(n),Array.isArray(r.items)&&r.items.forEach(o=>{const u=_s(o.materialName,o.originalName,r.vendorName,o.category);u&&!j0(u)&&a.add(u)})});const i=Array.from(a);return i.length===0?Array.from(EP):i.sort()}
function bY(e: any ): any {const{currentInvoices:t=[],currentDiscounts:a=[],previousInvoices:i=[],previousDiscounts:r=[],jobsites:n=[],supervisors:o=[],anomaliesCount:u=0}=e,c=t.filter(F=>!F.isDeleted),f=c.reduce((F,ae)=>F+(Number(ae.totalAmount)||0),0),m=c.reduce((F,ae)=>{const ue=Array.isArray(ae.items)?ae.items.reduce((re,Z)=>re+(Number(Z.discountAmount)||0),0):0;return F+(Number(ae.discount)||ue||0)},0),p=a.reduce((F,ae)=>{const ue=Math.max(0,(Number(ae.offerPrice)||0)-(Number(ae.agreedPrice)||0));return F+(Number(ae.discountAmount)||ue||0)},0),h=p>0?p:m,v=a.reduce((F,ae)=>{const ue=Number(ae.offerPrice)||0,re=Number(ae.agreedPrice)||0,Z=Number(ae.discountAmount)||0;return F+(ue>0?ue:re+Z)},0);c.reduce((F,ae)=>{const ue=Number(ae.totalAmount)||0,re=Array.isArray(ae.items)?ae.items.reduce((fe,Q)=>fe+(Number(Q.discountAmount)||0),0):0,Z=Number(ae.discount)||re||0,te=Number(ae.subtotal)||0;return F+(te>ue?te:ue+Z)},0);const N=v>0?v:f+h,y=N>0&&h>0?Number((h/N*100).toFixed(2)):0,S=i.filter(F=>!F.isDeleted).reduce((F,ae)=>F+(Number(ae.totalAmount)||0),0),T=r.reduce((F,ae)=>F+(Number(ae.discountAmount)||0),0),k=r.reduce((F,ae)=>F+(Number(ae.offerPrice)||Number(ae.agreedPrice)+Number(ae.discountAmount)||0),0)||S+T,w=k>0&&T>0?Number((T/k*100).toFixed(2)):0,M=GN(f,S),D=GN(h,T),E=Number((y-w).toFixed(2)),L=Array.isArray(n)?n.filter(F=>F.status==="Aktif").length:0,C=Array.isArray(o)?o.length:0,B=a.filter(F=>F.status==="Beklemede"||F.status==="İncelemede").length,K=c.length+a.length;return{totalSpend:f,spendChangePercentage:M,totalDiscount:h,discountChangePercentage:D,avgDiscountRate:y,discountRateChangePercentage:E,activeJobsitesCount:L,supervisorsCount:C,anomaliesCount:u,pendingTransactionsCount:B,totalTransactionsCount:K,invoicesCount:c.length,discountsCount:a.length}}
function SY(e: any ,t: any ,a: any =12): any {const i=[],r=new Date;for(let o=a-1;o>=0;o--){const u=new Date(r.getFullYear(),r.getMonth()-o,1),c=u.getFullYear(),f=u.getMonth(),m=`${c}-${String(f+1).padStart(2,"0")}`,p=`${AY[f]} ${c}`;i.push({monthKey:m,monthLabel:p,spend:0,discount:0,netSpend:0,transactionCount:0})}const n=new Map;return i.forEach(o=>n.set(o.monthKey,o)),Array.isArray(e)&&e.forEach(o=>{if(!o.date)return;const u=qN(o.date);if(!u)return;const c=n.get(u);if(c){const f=Number(o.totalAmount)||0;c.spend+=f,c.netSpend+=f,c.transactionCount+=1}}),Array.isArray(t)&&t.forEach(o=>{if(!o.orderDate)return;const u=qN(o.orderDate);if(!u)return;const c=n.get(u);if(c){const f=Number(o.discountAmount)||0;c.discount+=f,c.transactionCount+=1}}),i}
function kY(e: any ,t: any ,a: any =8): any {const i=new Map;Array.isArray(t)&&t.forEach(h=>{i.set(h.id,{spend:0,count:0,name:h.name})});let r=0;Array.isArray(e)&&e.forEach(h=>{if(h.test||(!h.jobsiteId&&!h.jobsiteName))return;const v=Number(h.totalAmount)||0;r+=v;let N=h.jobsiteId,y=N?i.get(N):null;if(!y&&h.jobsiteName){const found=Array.isArray(t)?t.find(s=>s.name===h.jobsiteName||s.name.toLowerCase()===h.jobsiteName.toLowerCase()):null;if(found){N=found.id;y=i.get(N)}}if(y){y.spend+=v;y.count+=1}else if(h.jobsiteName&&!h.jobsiteName.toLowerCase().includes("bilinmeyen")&&!h.jobsiteName.toLowerCase().includes("belirtilme")){i.set(N||h.jobsiteName,{spend:v,count:1,name:h.jobsiteName})}});const n=new Map;Array.isArray(t)&&t.forEach(h=>{n.set(h.id,Number(h.budget)||0)});const o=Array.from(i.entries()).filter(([h,v])=>v.spend>0).map(([h,v])=>{const N=n.get(h)||0,y=N>0?Number((v.spend/N*100).toFixed(1)):0,b=r>0?Number((v.spend/r*100).toFixed(1)):0;return{jobsiteId:h,jobsiteName:v.name,spend:v.spend,percentage:b,invoiceCount:v.count,budget:N,budgetUsagePercentage:y}}).sort((h,v)=>v.spend-h.spend);if(o.length<=a)return o;const u=o.slice(0,a),c=o.slice(a),f=c.reduce((h,v)=>h+v.spend,0),m=c.reduce((h,v)=>h+v.invoiceCount,0),p=r>0?Number((f/r*100).toFixed(1)):0;return u.push({jobsiteId:"others",jobsiteName:`Diğer Şantiyeler (${c.length})`,spend:f,percentage:p,invoiceCount:m,budget:0,budgetUsagePercentage:0}),u}
function PY(e: any ,t: any =8): any {const a=new Map;let i=0;Array.isArray(e)&&e.forEach(f=>{if(!f.isDeleted)if(Array.isArray(f.items)&&f.items.length>0)f.items.forEach(m=>{const p=_s(m.materialName,m.originalName,f.supplier,m.category),h=Number(m.totalPrice)||Number(m.unitPrice)*Number(m.quantity)||0;i+=h;const v=a.get(p)||{spend:0,count:0};v.spend+=h,v.count+=1,a.set(p,v)});else{const m=Number(f.totalAmount)||0;i+=m;const p=ps({supplier:f.supplier,notes:f.notes,items:f.items}),h=a.get(p)||{spend:0,count:0};h.spend+=m,h.count+=1,a.set(p,h)}});const r=Array.from(a.entries()).filter(([f,m])=>m.spend>0).map(([f,m])=>({category:f,spend:m.spend,percentage:i>0?Number((m.spend/i*100).toFixed(1)):0,itemCount:m.count})).sort((f,m)=>m.spend!==f.spend?m.spend-f.spend:f.category.localeCompare(m.category,"tr"));if(r.length<=t)return r;const n=r.slice(0,t),o=r.slice(t),u=o.reduce((f,m)=>f+m.spend,0),c=o.reduce((f,m)=>f+m.itemCount,0);return n.push({category:`Diğer Kategoriler (${o.length})`,spend:u,percentage:i>0?Number((u/i*100).toFixed(1)):0,itemCount:c}),n}
function TY(e: any ,t: any ): any {const a=new Map;return Array.isArray(t)&&t.forEach(i=>{a.set(i.id,{name:i.name,discount:0,spend:0,count:0,totalList:0})}),Array.isArray(e)&&e.forEach(i=>{const r=i.supervisorId||"unknown",n=a.get(r)||{name:i.supervisorName||"Bilinmeyen Şef",discount:0,spend:0,count:0,totalList:0},o=Number(i.discountAmount)||0,u=Number(i.agreedPrice)||0,c=Number(i.offerPrice)||u+o;n.discount+=o,n.spend+=u,n.totalList+=c,n.count+=1,a.set(r,n)}),Array.from(a.entries()).map(([i,r])=>{const n=r.totalList>0?Number((r.discount/r.totalList*100).toFixed(1)):0;return{supervisorId:i,supervisorName:r.name,totalDiscount:r.discount,totalSpend:r.spend,avgDiscountPercentage:n,transactionCount:r.count}}).sort((i,r)=>r.totalDiscount-i.totalDiscount)}
function wY(e: any ,t: any ): any {const a=`${e||""} ${t||""}`.toLowerCase();return["nakliye","nakliyat","taşımacılık","taşıma","teslimat","dağıtım","transport","transportation","dostavka","доставка","перевозка","транспорт","lojistik","logistics","логистика","kargo","kurye","navlun","freight","hizmet","hizmeti","servis","услуга","услуги","işçilik","montaj","vinç","kiralama","taksi","tahmil","tahliye","hammaliye","yükleme","boşaltma","kira"].some(r=>a.includes(r))}
function EY(e: any ,t: any =6,a: any ,i: any ): any {return Array.isArray(e)?e.filter(r=>{if(!r||r.minUnitPrice<=0||r.maxUnitPrice<=r.minUnitPrice||wY(r.materialName,r.category)||a&&a!=="ALL"&&(!r.category||r.category.toLowerCase().trim()!==a.toLowerCase().trim()))return!1;if(i&&i.trim()!==""){const n=i.toLowerCase().trim(),o=r.materialName&&r.materialName.toLowerCase().includes(n),u=r.category&&r.category.toLowerCase().includes(n);if(!o&&!u)return!1}return!0}).map(r=>({materialName:r.materialName,category:r.category||"Genel",unit:r.unit||"Birim",minPrice:r.minUnitPrice,maxPrice:r.maxUnitPrice,priceDiffPercentage:r.priceDifferencePercentage||Number(((r.maxUnitPrice-r.minUnitPrice)/r.minUnitPrice*100).toFixed(1)),cheapestJobsite:r.cheapestJobsiteName||"En Uygun",priciestJobsite:r.priciestJobsiteName||"En Yüksek"})).sort((r,n)=>n.priceDiffPercentage-r.priceDiffPercentage).slice(0,t):[]}
function DY(e: any ,t: any ,a: any =20): any {const i=[];Array.isArray(e)&&e.forEach(n=>{if(n.isDeleted)return;const o=Number(n.totalAmount)||0,u=Array.isArray(n.items)?n.items.reduce((N,y)=>N+(Number(y.discountAmount)||0),0):0,c=Number(n.discount)||u||0,f=Number(n.subtotal)&&Number(n.subtotal)>o?Number(n.subtotal):o+c,m=f>0&&c>0?Number((c/f*100).toFixed(2)):0,p=Array.isArray(n.items)?n.items:[],h=ps({supplier:n.supplier,notes:n.notes,items:p}),v=p.length>0?p.length===1?p[0].materialName:`${p[0].materialName} (+${p.length-1} kalem)`:`${h} Faturası`;i.push({id:n.id,type:"INVOICE",date:n.date||n.created_at||new Date().toISOString().split("T")[0],title:`Fatura: ${n.invoiceNumber||"No Belirtilmedi"}`,invoiceNumber:n.invoiceNumber||"",supplier:n.supplier||"Tedarikçi Firma",jobsiteName:n.jobsiteName||"Şantiye",jobsiteId:n.jobsiteId||"",supervisorName:n.uploadedBySupervisorName||"Yetkili Şef",supervisorId:n.uploadedBySupervisorId||"",category:h,materialSummary:v,itemCount:p.length||1,initialPrice:f,amount:o,discountAmount:c,discountPercentage:m,status:"Onaylandı",hasFile:!!(n.fileUrl||n.rawFileName),fileUrl:n.fileUrl||void 0,rawRecord:n})}),Array.isArray(t)&&t.forEach(n=>{const o=Number(n.agreedPrice)||0;let u=n.discountAmount!=null?Number(n.discountAmount):0;const c=n.adjustedOfferPrice!=null?Number(n.adjustedOfferPrice):Number(n.offerPrice)||o+u,f=c;n.discountAmount==null&&c>o&&o>0&&(u=c-o);let m=Number(n.discountPercentage)||0;(!m||m<=0)&&f>0&&u>0&&(m=Number((u/f*100).toFixed(2)));const p=Array.isArray(n.items)?n.items:[],h=ps({category:n.category,vendorName:n.vendorName,notes:n.notes,items:p}),v=p.length>0?p.length===1?p[0].materialName:`${p[0].materialName} (+${p.length-1} kalem)`:`${h} Alımı`;i.push({id:n.id,type:"DISCOUNT",date:n.orderDate||n.created_at||new Date().toISOString().split("T")[0],title:`Pazarlık: ${n.category||"Malzeme"}`,invoiceNumber:n.invoiceNo||"",supplier:n.vendorName||"Tedarikçi",jobsiteName:n.jobsiteName||"Şantiye",jobsiteId:n.jobsiteId||"",supervisorName:n.supervisorName||"Yetkili Şef",supervisorId:n.supervisorId||"",category:h,materialSummary:v,itemCount:p.length||1,initialPrice:f,amount:o,discountAmount:u,discountPercentage:m,status:n.status||"Onaylandı",recordOriginType:n.recordOriginType||(n.performedByPersonnelId||n.performedByPersonnelName?"asist":"gol"),performedByPersonnelName:n.performedByPersonnelName||void 0,negotiationCount:Array.isArray(n.negotiationRounds)?n.negotiationRounds.length:n.negotiationCount||0,crossNegotiationApplied:n.crossNegotiationApplied||!1,hasFile:!!(n.firstOfferFileUrl||n.finalOfferFileUrl),fileUrl:n.finalOfferFileUrl||n.firstOfferFileUrl||void 0,notes:n.notes||void 0,rawRecord:n})});const r=i.sort((n,o)=>{var f,m;const u=((f=hs(n.date))==null?void 0:f.getTime())||0;return(((m=hs(o.date))==null?void 0:m.getTime())||0)-u});return a>0?r.slice(0,a):r}
function OY(e: any ,t: any =5): any {return Array.isArray(e)?[...e].filter(a=>Number(a.discountPercentage)>0||Number(a.discountAmount)>0).sort((a,i)=>(Number(i.discountPercentage)||0)-(Number(a.discountPercentage)||0)).slice(0,t):[]}
function MY(e: any ,t: any ,a: any ): any {const i=[];return Array.isArray(a)&&a.forEach((r,n)=>{const o=r.priceDifferencePercentage||0;o>=20&&r.minUnitPrice>0&&i.push({id:`anom_comp_${n}`,type:"PRICE_GAP",severity:o>=40?"CRITICAL":"WARNING",title:`Şantiyeler Arası %${o.toFixed(0)} Fiyat Farkı`,materialOrSupplier:`${r.materialName} (${r.category})`,impactAmount:(r.maxUnitPrice-r.minUnitPrice)*(r.totalQuantityPurchased||1),percentageChange:o,date:r.history&&r.history.length>0?r.history[0].date:new Date().toISOString().split("T")[0]})}),Array.isArray(t)&&t.forEach(r=>{const n=Number(r.agreedPrice)||0,o=Number(r.discountPercentage)||0;n>=5e5&&o<2&&i.push({id:`anom_dsc_${r.id}`,type:"HIGH_VALUE_NO_DISCOUNT",severity:"WARNING",title:"Yüksek Tutarlı Düşük İskontolu Alım",materialOrSupplier:`${r.vendorName} - ${r.category}`,impactAmount:n*.05,percentageChange:o,date:r.orderDate||new Date().toISOString().split("T")[0]})}),i.slice(0,10)}
function CY(e: any ): any {const{kpis:t,filterInfo:a,jobsiteSpending:i,categorySpending:r,supervisorPerformance:n,recentTransactions:o}=e,u=XLSX.utils.book_new(),c=[["GES CONSTRUCTION - SATINALMA YÖNETİM RAPORU",""],["Rapor Oluşturma Tarihi:",new Date().toLocaleString("tr-TR")],["Filtre Tarih Aralığı:",a.dateRangeLabel],["Filtre Şantiye:",a.jobsiteLabel],["Filtre Kategori:",a.categoryLabel],[],["TEMEL PERFORMANS GÖSTERGELERİ (KPI)","DEĞER","ÖNCEKİ DÖNEME GÖRE DEĞİŞİM"],["Toplam Satınalma Harcaması (₽)",t.totalSpend,`%${t.spendChangePercentage}`],["Toplam Kazanılan İndirim (₽)",t.totalDiscount,`%${t.discountChangePercentage}`],["Ortalama İndirim Oranı (%)",`%${t.avgDiscountRate}`,`%${t.discountRateChangePercentage}`],["Aktif Şantiye Sayısı",t.activeJobsitesCount,"-"],["Satınalma Şefi Sayısı",t.supervisorsCount,"-"],["Tespit Edilen Anomali Sayısı",t.anomaliesCount,"-"],["Bekleyen / İncelemede Kayıt Sayısı",t.pendingTransactionsCount,"-"],["Toplam İşlem Sayısı (Fatura + İndirim)",t.totalTransactionsCount,"-"],["Fatura Sayısı",t.invoicesCount,"-"],["İndirim Kaydı Sayısı",t.discountsCount,"-"]],f=XLSX.utils.aoa_to_sheet(c);XLSX.utils.book_append_sheet(u,f,"Genel Özet & KPI");const m=[["ŞANTİYE BAZLI HARCAMA VE BÜTÇE KULLANIMI","","","",""],["Şantiye Adı","Toplam Harcama (₽)","Payı (%)","Fatura Sayısı","Toplam Bütçe (₽)","Bütçe Kullanımı (%)"]];i.forEach(k=>{m.push([k.jobsiteName,k.spend,`%${k.percentage}`,k.invoiceCount,k.budget>0?k.budget:"Bütçe Tanımsız",k.budget>0?`%${k.budgetUsagePercentage}`:"-"])});const p=XLSX.utils.aoa_to_sheet(m);XLSX.utils.book_append_sheet(u,p,"Şantiye Dağılımı");const h=[["KATEGORİ BAZLI SATINALMA DAĞILIMI","",""],["Kategori Adı","Toplam Harcama (₽)","Harcama Payı (%)","Kalem Sayısı"]];r.forEach(k=>{h.push([k.category,k.spend,`%${k.percentage}`,k.itemCount])});const v=XLSX.utils.aoa_to_sheet(h);XLSX.utils.book_append_sheet(u,v,"Kategori Dağılımı");const N=[["SATINALMA ŞEFLERİ İNDİRİM VE PERFORMANS TABLOSU","","","",""],["Şef Adı","Kazanılan Toplam İndirim (₽)","Yapılan Satınalma (₽)","Ortalama İndirim Oranı (%)","İşlem Sayısı"]];n.forEach(k=>{N.push([k.supervisorName,k.totalDiscount,k.totalSpend,`%${k.avgDiscountPercentage}`,k.transactionCount])});const y=XLSX.utils.aoa_to_sheet(N);XLSX.utils.book_append_sheet(u,y,"Şef Performansı");const b=[["SON SATINALMA VE İNDİRİM İŞLEMLERİ (DETAYLI LİSTE)","","","","","","","","","","","",""],["Tarih","İşlem Türü","Fatura / Belge No","Tedarikçi Firma","Kategori","Malzeme / Kalem","Şantiye","Yetkili Şef / Personel","İlk Teklif / Liste Fiyatı (₽)","Nihai / Fatura Tutarı (₽)","Kazanılan İndirim (₽)","İndirim Oranı (%)","Gol / Asist","Durum"]];o.forEach(k=>{b.push([k.date,k.type==="INVOICE"?"Fatura":"İndirim Girişi",k.invoiceNumber||k.title,k.supplier,k.category||"-",k.materialSummary||"-",k.jobsiteName,k.performedByPersonnelName?`${k.supervisorName} (${k.performedByPersonnelName})`:k.supervisorName,k.initialPrice||k.amount+(k.discountAmount||0),k.amount,k.discountAmount||0,`%${(k.discountPercentage||0).toFixed(2)}`,k.recordOriginType?k.recordOriginType==="gol"?"Gol":"Asist":"-",k.status])});const S=XLSX.utils.aoa_to_sheet(b);XLSX.utils.book_append_sheet(u,S,"Son İşlemler");const T=`GESCONS_Dashboard_Raporu_${new Date().toISOString().split("T")[0]}.xlsx`;XLSX.writeFile(u,T)}
function _I(e: any ): any {if(!e)return"ŞF";const t=e.trim().split(/\s+/);return t.length===1?t[0].substring(0,2).toUpperCase():(t[0][0]+t[t.length-1][0]).toUpperCase()}
export function calculateSmartFinancialScore(
  totalSavings: number,
  savingsRatePct: number,
  totalListPrice: number,
  transactionCount: number,
  maxSavingsInTeam: number,
  maxRateInTeam: number = 12.0
): number {
  if (totalSavings <= 0 || totalListPrice <= 0) return 0;

  // 1. İskonto Oranı & Verimlilik Skoru (%60 AĞIRLIK - TEMEL SÜRÜCÜ):
  // İskonto oranı yüksek olan şefe avantaj sağlar (%10.5 alan şef ~90 baz puan alır).
  const benchmarkRate = Math.max(maxRateInTeam, 10.0);
  const rawRateScore = Math.min(100, Math.max(0, (savingsRatePct / benchmarkRate) * 100));

  // Güvenilirlik koruması: Tek seferlik tesadüfi 1 işlem (%20 indirim) anomalilerini filtreler,
  // ancak 4+ işlem yapan şefleri asla harcama tutarı az diye cezalandırmaz.
  const sampleConfidence = Math.min(1.0, Math.max(0.35, Math.sqrt(transactionCount / 6)));
  const credibleRateScore = rawRateScore * sampleConfidence;

  // 2. Nakit Tasarruf Katkısı (%25 AĞIRLIK - LOGARİTMİK DESTEK):
  // Şirket kasasına kazandırılan net reel nakit para desteği.
  // Logaritmik ölçekleme sayesinde 100M harcayan dev alımlar skoru haksız yere domine edemez.
  const maxSavings = Math.max(maxSavingsInTeam, totalSavings, 1);
  const logSavings = Math.log10(Math.max(10, totalSavings));
  const logMaxSavings = Math.log10(Math.max(10, maxSavings));
  const volumeScore = logMaxSavings > 0 ? Math.min(100, Math.max(0, (logSavings / logMaxSavings) * 100)) : 50;

  // 3. İşlem İstikrarı & Portföy Gücü (%15 AĞIRLIK):
  // Pazarlık masasında süreklilik gösteren, düzenli indirim kovalayan şefin istikrarı.
  const consistencyScore = Math.min(100, Math.max(0, Math.sqrt(transactionCount / 25) * 100));

  // Toplam Finansal Skor: %60 İskonto Yüzdesi + %25 Nakit Katkısı + %15 İşlem İstikrarı
  const blendedScore = credibleRateScore * 0.60 + volumeScore * 0.25 + consistencyScore * 0.15;

  return Math.round(Math.min(100, Math.max(0, blendedScore)));
}

function dc(e: any ,t: any ,a: any ): any {if(a===t)return e>0?100:0;const i=(e-t)/(a-t)*100;return Math.round(Math.max(0,Math.min(100,i)))}
function pI(e: any =[],t: any =[],a: any =[],i: any =[],r: any =mI,n: any ="MVP"): any {
  if(!t||t.length===0)return[];
  const o=e.filter(B=>!B.isDeleted&&B.status!=="İncelemede");
  const u=t.map(B=>{
    const K=o.filter(ie=>ie.supervisorId===B.id||ie.supervisorName&&ie.supervisorName.toLowerCase()===B.name.toLowerCase());
    const F=(a||[]).filter(ie=>ie.supervisorId===B.id);
    const ae=new Set(F.map(ie=>ie.id));
    let ue=0,re=0,Z=0,te=0,fe=0,Q=0,Ae=0,Y=0,j=0;
    const G=new Set,H=[],W=new Map;
    F.forEach(ie=>{W.set(ie.id,{count:0,savings:0})});
    K.forEach(ie=>{
      const isMarketKpi = ie.calculationMethod === 'MARKET_BASELINE_TO_FINAL' && ie.realMarketSavings != null;
      const Me = isMarketKpi ? (Number(ie.realMarketSavings) || 0) : (Number(ie.discountAmount) || 0);
      const R = Number(ie.marketReferencePrice || ie.adjustedOfferPrice || ie.offerPrice) || ((Number(ie.agreedPrice) || 0) + Me);
      ue += Me;
      re += R;
      const We = Array.isArray(ie.negotiationRounds) && ie.negotiationRounds.length > 0
        ? ie.negotiationRounds.length
        : (Array.isArray(ie.stageDocuments) && ie.stageDocuments.length > 2
            ? ie.stageDocuments.length - 2
            : Number(ie.negotiationCount) || 0);
      Ae += We;
      We > 0 && (Y += 1);
      We > 1 && (j += 1);
      ie.isNewVendor && ie.vendorName && G.add(ie.vendorName.trim());
      const Ne = ie.recordOriginType === "asist" || (ie.performedByPersonnelId && ie.performedByPersonnelId !== B.id && ae.has(ie.performedByPersonnelId));
      if (Ne) {
        fe += 1;
        Q += Me;
        if (ie.performedByPersonnelId && W.has(ie.performedByPersonnelId)) {
          const me = W.get(ie.performedByPersonnelId);
          me.count += 1;
          me.savings += Me;
        }
      } else {
        Z += 1;
        te += Me;
      }
      H.push({
        id: ie.id,
        vendorName: ie.vendorName || "Bilinmeyen Tedarikçi",
        jobsiteName: ie.jobsiteName || "Merkez",
        category: ie.category || "Genel",
        discountAmount: Me,
        discountPercentage: Number(ie.realSavingsPercentage || ie.discountPercentage) || (R > 0 ? Number(((Me / R) * 100).toFixed(2)) : 0),
        roundsCount: We,
        date: ie.orderDate || "",
        orderOrigin: Ne ? "asist" : "gol",
        performedByName: ie.performedByPersonnelName
      });
    });
    H.sort((ie,Me)=>Me.discountAmount-ie.discountAmount);
    const le = H.slice(0,5);
    const Se = K.length > 0 ? Number((Ae / K.length).toFixed(2)) : 0;
    const Ee = re > 0 ? Number((ue / re * 100).toFixed(2)) : 0;
    const se = F.map(ie=>{
      const Me=W.get(ie.id)||{count:0,savings:0};
      return {
        id: ie.id,
        name: ie.name,
        title: ie.title || "Satınalma Personeli",
        assistsCount: Me.count,
        savingsContributed: Me.savings
      };
    }).sort((ie,Me)=>Me.savingsContributed-ie.savingsContributed);

    return {
      supervisorId: B.id,
      supervisorName: B.name,
      title: B.title || "Satınalma Şefi",
      initials: _I(B.name),
      department: B.department || "Satınalma & Tedarik",
      teamSize: F.length,
      teamMembers: se,
      rawMetrics: {
        totalSavings: ue,
        totalListPrice: re,
        totalSpend: Math.max(0, re - ue),
        savingsRatePct: Ee,
        directGoalsCount: Z,
        directGoalsSavings: te,
        teamAssistsCount: fe,
        teamAssistsSavings: Q,
        totalNegotiationRounds: Ae,
        negotiatedDealsCount: Y,
        avgNegotiationRounds: Se,
        multiRoundDealsCount: j,
        newVendorsCount: G.size,
        newVendorNames: Array.from(G),
        totalTransactions: K.length
      },
      flagshipDeals: le
    };
  });

  const c = u.map(B => B.rawMetrics.totalSavings);
  const f = u.map(B => B.rawMetrics.directGoalsCount);
  const m = u.map(B => B.rawMetrics.avgNegotiationRounds); // İşlem başına düşen ortalama tur sayısı
  const p = u.map(B => B.rawMetrics.teamAssistsCount);
  const h = u.map(B => B.rawMetrics.newVendorsCount);
  const txs = u.map(B => B.rawMetrics.totalTransactions);
  const rates = u.map(B => B.rawMetrics.savingsRatePct);

  const maxSavingsInTeam = Math.max(...c, 1);
  const maxRateInTeam = Math.max(...rates, 5.0);
  const totalRoundsList = u.map(B => B.rawMetrics.totalNegotiationRounds);
  const maxTotalRounds = Math.max(...totalRoundsList, 1);
  const maxAvgRounds = Math.max(...m, 0.1);
  const maxGoals = Math.max(...f, 1);
  const maxAssists = Math.max(...p, 1);
  const maxVendors = Math.max(...h, 1);
  const maxTx = Math.max(...txs, 1);

  const L = [...u.map(B => {
    // 1. K: Finansal Skor (İskonto Oranı %75 + Nakit Tasarruf Katkısı %15 + İşlem İstikrarı %10)
    const K = calculateSmartFinancialScore(
      B.rawMetrics.totalSavings,
      B.rawMetrics.savingsRatePct,
      B.rawMetrics.totalListPrice,
      B.rawMetrics.totalTransactions,
      maxSavingsInTeam,
      maxRateInTeam
    );

    // 2. F: Bireysel Doğrudan GOL Skoru (Şefin bizzat masaya oturup kopardığı indirimler)
    const F = maxGoals > 0
      ? Math.round(Math.min(100, Math.max(0, (B.rawMetrics.directGoalsCount / maxGoals) * 100)))
      : 0;

    // 3. txScore: İşlem Kapsamı & Pazarlık Israrı (Her alımda indirim talep etme disiplini)
    const txScore = maxTx > 0
      ? Math.round(Math.min(100, Math.max(0, (B.rawMetrics.totalTransactions / maxTx) * 100)))
      : 0;

    // 4. ue: Ekip Asistleri Skoru (Bağlı uzman personelin indirimlerine rehberlik ve liderlik)
    const ue = maxAssists > 0
      ? Math.round(Math.min(100, Math.max(0, (B.rawMetrics.teamAssistsCount / maxAssists) * 100)))
      : 0;

    // 5. ae: Müzakere Turu Skoru (İşlem başına ortalama tur %40 + Çok turlu çetin pazarlıklar %35 + Toplam tur hacmi %25)
    const maxMultiRounds = Math.max(...u.map(s => s.rawMetrics.multiRoundDealsCount), 1);
    const roundIntensity = maxAvgRounds > 0 ? (B.rawMetrics.avgNegotiationRounds / maxAvgRounds) * 100 : 0;
    const roundMulti = maxMultiRounds > 0 ? (B.rawMetrics.multiRoundDealsCount / maxMultiRounds) * 100 : 0;
    const roundVolume = maxTotalRounds > 0 ? (B.rawMetrics.totalNegotiationRounds / maxTotalRounds) * 100 : 0;
    const ae = Math.round(Math.min(100, Math.max(0, roundIntensity * 0.40 + roundMulti * 0.35 + roundVolume * 0.25)));

    // 6. re: Tedarik Ağı Genişleme Skoru (Yeni onaylı alternatif tedarikçiler kazandırma)
    const re = maxVendors > 0
      ? Math.round(Math.min(100, Math.max(0, (B.rawMetrics.newVendorsCount / maxVendors) * 100)))
      : 0;

    // Bileşik MVP Skoru (Ağırlıklı Toplam):
    // r.individualGoals: %25 (Bireysel GOL Krallığı - Doğrudan Masada Kazanılan İndirimler)
    // r.teamAssists: %20 (Ekip Asistleri - Takım Liderliği & Asist Hacmi)
    // r.financialSavings: %25 (İndirim Oranı & Finansal Verimlilik)
    // r.negotiationRounds: %15 (Müzakere Turları - Pazarlık Derinliği & Azim)
    // r.networkExpansion: %15 (Yeni Tedarikçi Kazandırma - Alternatif Pazar Portföyü)
    const wGoals = r.individualGoals ?? 0.25;
    const wAssists = r.teamAssists ?? 0.20;
    const wFin = r.financialSavings ?? 0.25;
    const wRounds = r.negotiationRounds ?? 0.15;
    const wNetwork = (r as any).networkExpansion ?? 0.15;
    const wTx = (r as any).negotiationBreadth ?? 0.00;

    const totalWeight = (wGoals + wAssists + wFin + wRounds + wNetwork + wTx) || 1.0;
    const Z = (wGoals * F + wAssists * ue + wFin * K + wRounds * ae + wNetwork * re + wTx * txScore) / totalWeight;
    const te = Number(Z.toFixed(1));

    let fe = te, Q = `${te} MVP`;
    switch(n) {
      case "MVP": {
        fe = te;
        Q = `${te} MVP`;
        break;
      }
      case "GOL":
        fe = B.rawMetrics.directGoalsCount;
        Q = `${B.rawMetrics.directGoalsCount} Doğrudan İşlem (${ua(B.rawMetrics.directGoalsSavings)})`;
        break;
      case "ASIST":
        fe = B.rawMetrics.teamAssistsCount;
        Q = `${B.rawMetrics.teamAssistsCount} Ekip Asisti (${ua(B.rawMetrics.teamAssistsSavings)})`;
        break;
      case "NEGOTIATION_ROUNDS":
        fe = ae;
        Q = B.rawMetrics.avgNegotiationRounds > 0 ? `${B.rawMetrics.avgNegotiationRounds.toFixed(2)} Tur/İşlem (${B.rawMetrics.totalNegotiationRounds} Tur)` : "0 Tur";
        break;
      case "NETWORK_EXPANSION":
        fe = B.rawMetrics.newVendorsCount;
        Q = `${B.rawMetrics.newVendorsCount} Yeni Tedarikçi`;
        break;
      case "FINANCIAL_SAVINGS":
        fe = K;
        Q = `%${B.rawMetrics.savingsRatePct} İskonto (${ua(B.rawMetrics.totalSavings)})`;
        break;
    }

    return {
      ...B,
      normalizedScores: {
        financialScore: K,
        goalsScore: F,
        roundsScore: ae,
        assistsScore: ue,
        networkScore: re,
        transactionScore: txScore
      },
      mvpScore: te,
      mvpRank: 1,
      categoryRank: 1,
      categoryScore: fe,
      categoryDisplayValue: Q
    };
  })].sort((B,K) => K.mvpScore - B.mvpScore);

  L.forEach((B,K) => { B.mvpRank = K + 1; });

  const C = [...L].sort((B,K) => {
    if (K.categoryScore !== B.categoryScore) {
      return K.categoryScore - B.categoryScore;
    }
    return K.rawMetrics.totalSavings - B.rawMetrics.totalSavings;
  });
  C.forEach((B,K) => { B.categoryRank = K + 1; });
  return C;
}
