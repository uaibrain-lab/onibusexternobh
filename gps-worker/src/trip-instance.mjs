// Strict identity guard for matching a realtime trip to an exact scheduled instance.
// No inference from GPS position, route alone or nearby departure times.
const DATE = /^\d{8}$/;
const TIME = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/;
function validDate(s) {
  if (typeof s !== 'string' || !DATE.test(s)) return false;
  const y=Number(s.slice(0,4)),m=Number(s.slice(4,6)),d=Number(s.slice(6));
  if(y<2000||y>2100)return false;
  const x=new Date(Date.UTC(y,m-1,d));
  return x.getUTCFullYear()===y&&x.getUTCMonth()===m-1&&x.getUTCDate()===d;
}
function validTime(s) {
  if(typeof s!=='string')return false;
  const m=TIME.exec(s);
  return !!m && Number(m[1])<=47;
}
export function sameTripInstance(scheduled, realtime) {
  if (!scheduled || !realtime) return false;
  for (const key of ['tripId','routeId','startDate','startTime']) {
    if(typeof scheduled[key]!=='string'||!scheduled[key]||scheduled[key]!==realtime[key])return false;
  }
  if(!validDate(scheduled.startDate)||!validTime(scheduled.startTime))return false;
  const a=scheduled.stopSequence,b=realtime.currentStopSequence;
  return Number.isSafeInteger(a)&&a>=0&&Number.isSafeInteger(b)&&b>=0&&a===b;
}
