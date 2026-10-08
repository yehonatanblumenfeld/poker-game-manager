// Strings for English and Hebrew. Keys are grouped by screen.
// {name} style placeholders are filled by t(key, vars).

const en = {
  'app.tagline': 'Home poker, settled.',
  'lang.switch': 'עברית',
  'lang.switchLabel': 'Switch to Hebrew',

  'home.new': 'New game',
  'home.join': 'Join a game',
  'home.joinPlaceholder': 'Game code',
  'home.joinGo': 'Join',
  'home.active': 'Open games',
  'home.hosting': 'You’re hosting',
  'home.playing': 'You joined',
  'home.history': 'Past games & stats',
  'home.empty': 'Start a game, then share the invite. Players join from their own phones with no sign-up.',

  'new.title': 'New game',
  'new.name': 'Game name',
  'new.namePlaceholder': 'Friday night',
  'new.type': 'Game type',
  'new.fixed': 'Fixed buy-in',
  'new.fixedHint': 'Every buy-in is the same amount.',
  'new.cash': 'Cash game',
  'new.cashHint': 'Players buy in for any amount.',
  'new.currency': 'Currency',
  'new.buyIn': 'Buy-in',
  'new.defaultBuyIn': 'Default buy-in',
  'new.chips': 'Chips',
  'new.byRatio': 'Chip value',
  'new.byStack': 'Chips per buy-in',
  'new.ratioEq': '{money} =',
  'new.chipsUnit': 'chips',
  'new.preview': '{money} buys {chips} chips · 1 chip = {each}',
  'new.seats': 'Seats at the table',
  'new.you': 'Your name',
  'new.youPlaceholder': 'Host',
  'new.playing': 'I’m playing too',
  'new.create': 'Open the table',
  'new.back': 'Back',

  'game.pot': 'In the pot',
  'game.chipsInPlay': '{chips} chips in play',
  'game.invite': 'Invite',
  'game.addPlayer': 'Add player',
  'game.end': 'End game',
  'game.log': 'Activity',
  'game.players': 'Players',
  'game.buyIn': 'Buy in',
  'game.addBuyIn': 'Add buy-in',
  'game.leave': 'Cash out & leave',
  'game.return': 'Back in the game',
  'game.pickSeat': 'Tap an empty seat to sit down.',
  'game.standing': 'Not seated',
  'game.you': 'You',
  'game.host': 'Host',
  'game.left': 'Left',
  'game.offline': 'Offline',
  'game.buyIns': '{n}×',
  'game.noBuyIns': 'No buy-in yet',
  'game.keepOpen': 'Keep this screen open during the game. If it locks, players still see the table, but buy-ins wait until you’re back.',
  'game.gotIt': 'Got it',
  'game.elapsed': 'Running {time}',
  'game.notFound': 'This game isn’t on this device.',
  'game.goHome': 'Back to start',
  'game.menu': 'Menu',
  'game.copyCode': 'Code',
  'game.rail': 'Not seated',

  'conn.connecting': 'Connecting to the host…',
  'conn.online': 'Connected',
  'conn.offline': 'Reconnecting…',
  'conn.noHost': 'The host’s screen is off or closed. You still see the table; buy-ins work again once they’re back.',
  'conn.hostLive': 'Live',
  'conn.hostAway': 'Host away',
  'conn.offlineShort': 'No connection',
  'conn.hostStarting': 'Opening the table…',
  'conn.hostOffline': 'Offline. Players can’t connect right now. Retrying…',
  'conn.otherTab': 'This game is open in another tab or device. Close it there to host here.',

  'join.title': 'Join the game',
  'join.code': 'Game {code}',
  'join.name': 'Your name',
  'join.go': 'Take a seat',

  'invite.title': 'Invite players',
  'invite.scan': 'Scan to join, or share the link.',
  'invite.copy': 'Copy link',
  'invite.copied': 'Link copied',
  'invite.share': 'Share',
  'invite.shareText': 'Join our poker game: {name}',

  'buyin.title': 'Buy in',
  'buyin.titleFor': 'Buy in for {name}',
  'buyin.fixedEach': '{money} each · {chips} chips',
  'buyin.count': 'How many buy-ins',
  'buyin.amount': 'Amount',
  'buyin.gets': 'Gets {chips} chips',
  'buyin.confirm': 'Buy in for {money}',

  'leave.title': 'Cash out',
  'leave.titleFor': 'Cash out {name}',
  'leave.count': 'Count your chips',
  'leave.countFor': 'Chips {name} is leaving with',
  'leave.worth': 'Worth {money}',
  'leave.confirm': 'Leave the table',
  'leave.settleNow': 'Settled now with the host',
  'leave.settleNowHint': 'Money changed hands already, so the final settle-up skips them.',

  'you.up': 'You’re up {money}',
  'you.down': 'You’re down {money}',
  'you.even': 'You broke even',
  'you.leftWith': 'You left with {chips} chips',
  'you.finalAtEnd': 'Your payments are worked out when the host ends the game.',
  'you.pay': 'You pay {name} {money}',
  'you.get': '{name} pays you {money}',
  'you.settledEarly': 'Settled with the host when you left.',
  'you.nothing': 'Nothing to pay or collect.',

  'player.bought': 'Bought in',
  'player.leftWith': 'Left with {chips} chips',
  'player.history': 'Buy-ins',
  'player.undo': 'Undo',
  'player.undone': 'Buy-in removed',
  'player.rename': 'Rename',
  'player.remove': 'Remove from game',
  'player.seat': 'Seat',
  'player.noSeat': 'No seat',
  'player.save': 'Save',
  'player.namePlaceholder': 'Name',
  'player.add': 'Add',

  'end.title': 'End the game',
  'end.intro': 'Enter every stack still on the table.',
  'end.leftAlready': 'already left',
  'end.expected': 'Bought',
  'end.counted': 'Counted',
  'end.diffOver': '{chips} chips too many',
  'end.diffUnder': '{chips} chips missing',
  'end.matches': 'Counts match',
  'end.adjust': 'Spread the difference across stacks',
  'end.adjustHint': 'Each stack still on the table is scaled so the totals match.',
  'end.confirm': 'Settle up',
  'end.fixFirst': 'Fix the counts or spread the difference to settle.',

  'res.title': 'Settle-up',
  'res.duration': 'Played {time}',
  'res.payments': 'Payments',
  'res.fewest': 'Fewest payments',
  'res.bank': 'Everyone via host',
  'res.pays': 'pays',
  'res.paid': 'Paid',
  'res.early': 'at leave',
  'res.allSquare': 'Everyone’s square. No payments needed.',
  'res.share': 'Share results',
  'res.copied': 'Results copied',
  'res.reopen': 'Reopen the game',
  'res.rematch': 'Run it back',
  'res.rematchHint': 'Same players, seats and link. Buy-ins start fresh.',
  'res.bought': 'In {money}',
  'res.out': 'Out {money}',
  'res.adjusted': 'Stacks were scaled to match the chips bought.',
  'res.waiting': 'The host is counting chips…',

  'log.title': 'Activity',
  'log.created': '{name} opened the table',
  'log.join': '{name} joined',
  'log.sit': '{name} sat down',
  'log.buyin': '{name} bought in for {money}',
  'log.undo': 'A {money} buy-in by {name} was removed',
  'log.leave': '{name} cashed out with {chips} chips',
  'log.return': '{name} is back in',
  'log.rename': '{old} is now {name}',
  'log.remove': '{name} was removed',
  'log.end': 'The game ended',
  'log.reopen': 'The game was reopened',
  'log.empty': 'Nothing yet.',

  'toast.join': '{name} joined the game',
  'toast.buyin': '{name} bought in for {money}',
  'toast.leave': '{name} cashed out',
  'toast.return': '{name} is back in',
  'toast.end': 'The game is over. Check the settle-up.',
  'toast.reopen': 'The host reopened the game',
  'toast.rematch': 'New game started. Same seats.',
  'toast.undo': 'A buy-in by {name} was removed',

  'err.generic': 'Something went wrong. Try again.',
  'err.timeout': 'The host didn’t answer. Check your connection.',
  'err.seatTaken': 'That seat was just taken.',
  'err.name': 'Enter a name.',
  'err.amount': 'Enter an amount.',
  'err.notAllowed': 'Only the host can do that.',
  'err.ended': 'The game has ended.',
  'err.hasBuyIns': 'Players with buy-ins can’t be removed. Undo their buy-ins first.',

  'stats.title': 'Past games',
  'stats.leaderboard': 'All-time',
  'stats.games': '{n} games',
  'stats.game1': '1 game',
  'stats.none': 'Finished games show up here.',
  'stats.delete': 'Delete',
  'stats.clearConfirm': 'Remove this game from your history?',

  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.confirm': 'Confirm',
  'common.chips': '{chips} chips',
};

const he = {
  'app.tagline': 'פוקר ביתי, סגור עד השקל.',
  'lang.switch': 'English',
  'lang.switchLabel': 'Switch to English',

  'home.new': 'משחק חדש',
  'home.join': 'הצטרפות למשחק',
  'home.joinPlaceholder': 'קוד משחק',
  'home.joinGo': 'הצטרפות',
  'home.active': 'משחקים פתוחים',
  'home.hosting': 'אתה המארח',
  'home.playing': 'הצטרפת',
  'home.history': 'משחקים קודמים וסטטיסטיקה',
  'home.empty': 'פותחים משחק ושולחים הזמנה. השחקנים מצטרפים מהטלפון שלהם, בלי הרשמה.',

  'new.title': 'משחק חדש',
  'new.name': 'שם המשחק',
  'new.namePlaceholder': 'שישי בערב',
  'new.type': 'סוג משחק',
  'new.fixed': 'באי-אין קבוע',
  'new.fixedHint': 'כל כניסה באותו סכום.',
  'new.cash': 'קאש',
  'new.cashHint': 'כל שחקן נכנס בכל סכום.',
  'new.currency': 'מטבע',
  'new.buyIn': 'באי-אין',
  'new.defaultBuyIn': 'באי-אין ברירת מחדל',
  'new.chips': 'ז׳יטונים',
  'new.byRatio': 'שווי ז׳יטון',
  'new.byStack': 'ז׳יטונים לכניסה',
  'new.ratioEq': '{money} =',
  'new.chipsUnit': 'ז׳יטונים',
  'new.preview': '{money} = {chips} ז׳יטונים · ז׳יטון אחד = {each}',
  'new.seats': 'מקומות ליד השולחן',
  'new.you': 'השם שלך',
  'new.youPlaceholder': 'מארח',
  'new.playing': 'גם אני משחק',
  'new.create': 'פתיחת השולחן',
  'new.back': 'חזרה',

  'game.pot': 'בקופה',
  'game.chipsInPlay': '{chips} ז׳יטונים במשחק',
  'game.invite': 'הזמנה',
  'game.addPlayer': 'הוספת שחקן',
  'game.end': 'סיום משחק',
  'game.log': 'פעילות',
  'game.players': 'שחקנים',
  'game.buyIn': 'כניסה',
  'game.addBuyIn': 'כניסה נוספת',
  'game.leave': 'יציאה מהמשחק',
  'game.return': 'חזרה למשחק',
  'game.pickSeat': 'לוחצים על כיסא פנוי כדי לשבת.',
  'game.standing': 'לא יושב',
  'game.you': 'אתה',
  'game.host': 'מארח',
  'game.left': 'יצא',
  'game.offline': 'מנותק',
  'game.buyIns': '{n}×',
  'game.noBuyIns': 'עוד לא נכנס',
  'game.keepOpen': 'השאירו את המסך פתוח במהלך המשחק. אם הוא ננעל, השחקנים עדיין רואים את השולחן, אבל כניסות יחכו עד שתחזרו.',
  'game.gotIt': 'הבנתי',
  'game.elapsed': 'רץ {time}',
  'game.notFound': 'המשחק הזה לא נמצא במכשיר.',
  'game.goHome': 'למסך הראשי',
  'game.menu': 'תפריט',
  'game.copyCode': 'קוד',
  'game.rail': 'לא יושבים',

  'conn.connecting': 'מתחברים למארח…',
  'conn.online': 'מחובר',
  'conn.offline': 'מתחברים מחדש…',
  'conn.noHost': 'המסך של המארח כבוי או סגור. השולחן עדיין מוצג, וכניסות יעבדו שוב כשהוא יחזור.',
  'conn.hostLive': 'פעיל',
  'conn.hostAway': 'המארח לא מחובר',
  'conn.offlineShort': 'אין חיבור',
  'conn.hostStarting': 'פותחים את השולחן…',
  'conn.hostOffline': 'אין חיבור. שחקנים לא יכולים להתחבר כרגע. מנסים שוב…',
  'conn.otherTab': 'המשחק פתוח בלשונית או במכשיר אחר. סגרו אותו שם כדי לארח כאן.',

  'join.title': 'הצטרפות למשחק',
  'join.code': 'משחק {code}',
  'join.name': 'השם שלך',
  'join.go': 'לשבת לשולחן',

  'invite.title': 'הזמנת שחקנים',
  'invite.scan': 'סורקים כדי להצטרף, או משתפים את הקישור.',
  'invite.copy': 'העתקת קישור',
  'invite.copied': 'הקישור הועתק',
  'invite.share': 'שיתוף',
  'invite.shareText': 'בואו לפוקר: {name}',

  'buyin.title': 'כניסה',
  'buyin.titleFor': 'כניסה עבור {name}',
  'buyin.fixedEach': '{money} לכניסה · {chips} ז׳יטונים',
  'buyin.count': 'כמה כניסות',
  'buyin.amount': 'סכום',
  'buyin.gets': 'מקבל {chips} ז׳יטונים',
  'buyin.confirm': 'כניסה ב־{money}',

  'leave.title': 'יציאה',
  'leave.titleFor': 'יציאה של {name}',
  'leave.count': 'כמה ז׳יטונים יש לך',
  'leave.countFor': 'כמה ז׳יטונים יש ל־{name}',
  'leave.worth': 'שווה {money}',
  'leave.confirm': 'לקום מהשולחן',
  'leave.settleNow': 'סגר עכשיו מול המארח',
  'leave.settleNowHint': 'הכסף כבר עבר, אז ההתחשבנות בסוף מדלגת עליו.',

  'you.up': 'אתה בפלוס {money}',
  'you.down': 'אתה במינוס {money}',
  'you.even': 'יצאת באפס',
  'you.leftWith': 'יצאת עם {chips} ז׳יטונים',
  'you.finalAtEnd': 'מי משלם למי ייקבע כשהמארח יסיים את המשחק.',
  'you.pay': 'אתה משלם ל־{name} {money}',
  'you.get': '{name} משלם לך {money}',
  'you.settledEarly': 'סגרת מול המארח כשיצאת.',
  'you.nothing': 'אין מה לשלם או לקבל.',

  'player.bought': 'סך כניסות',
  'player.leftWith': 'יצא עם {chips} ז׳יטונים',
  'player.history': 'כניסות',
  'player.undo': 'ביטול',
  'player.undone': 'הכניסה בוטלה',
  'player.rename': 'שינוי שם',
  'player.remove': 'הסרה מהמשחק',
  'player.seat': 'כיסא',
  'player.noSeat': 'בלי כיסא',
  'player.save': 'שמירה',
  'player.namePlaceholder': 'שם',
  'player.add': 'הוספה',

  'end.title': 'סיום המשחק',
  'end.intro': 'מזינים כמה ז׳יטונים יש לכל מי שעוד ליד השולחן.',
  'end.leftAlready': 'כבר יצא',
  'end.expected': 'נקנו',
  'end.counted': 'נספרו',
  'end.diffOver': '{chips} ז׳יטונים יותר מדי',
  'end.diffUnder': 'חסרים {chips} ז׳יטונים',
  'end.matches': 'הספירה מתאימה',
  'end.adjust': 'לפזר את ההפרש על הערימות',
  'end.adjustHint': 'כל ערימה שעוד על השולחן מותאמת יחסית כדי שהסכומים יתאימו.',
  'end.confirm': 'התחשבנות',
  'end.fixFirst': 'צריך לתקן את הספירה או לפזר את ההפרש.',

  'res.title': 'התחשבנות',
  'res.duration': 'שיחקתם {time}',
  'res.payments': 'תשלומים',
  'res.fewest': 'הכי מעט העברות',
  'res.bank': 'הכול דרך המארח',
  'res.pays': 'משלם ל',
  'res.paid': 'שולם',
  'res.early': 'ביציאה',
  'res.allSquare': 'כולם מאוזנים. אין תשלומים.',
  'res.share': 'שיתוף תוצאות',
  'res.copied': 'התוצאות הועתקו',
  'res.reopen': 'פתיחה מחדש',
  'res.rematch': 'עוד סיבוב',
  'res.rematchHint': 'אותם שחקנים, כיסאות וקישור. הכניסות מתאפסות.',
  'res.bought': 'נכנס {money}',
  'res.out': 'יצא {money}',
  'res.adjusted': 'הערימות הותאמו כדי להתאים לז׳יטונים שנקנו.',
  'res.waiting': 'המארח סופר ז׳יטונים…',

  'log.title': 'פעילות',
  'log.created': '{name} פתח את השולחן',
  'log.join': '{name} הצטרף',
  'log.sit': '{name} התיישב',
  'log.buyin': '{name} נכנס ב־{money}',
  'log.undo': 'כניסה של {name} ב־{money} בוטלה',
  'log.leave': '{name} יצא עם {chips} ז׳יטונים',
  'log.return': '{name} חזר למשחק',
  'log.rename': '{old} שינה שם ל־{name}',
  'log.remove': '{name} הוסר',
  'log.end': 'המשחק הסתיים',
  'log.reopen': 'המשחק נפתח מחדש',
  'log.empty': 'עוד אין פעילות.',

  'toast.join': '{name} הצטרף למשחק',
  'toast.buyin': '{name} נכנס ב־{money}',
  'toast.leave': '{name} יצא מהמשחק',
  'toast.return': '{name} חזר למשחק',
  'toast.end': 'המשחק נגמר. אפשר לראות את ההתחשבנות.',
  'toast.reopen': 'המארח פתח את המשחק מחדש',
  'toast.rematch': 'סיבוב חדש התחיל. אותם כיסאות.',
  'toast.undo': 'כניסה של {name} בוטלה',

  'err.generic': 'משהו השתבש. נסו שוב.',
  'err.timeout': 'המארח לא ענה. בדקו את החיבור.',
  'err.seatTaken': 'מישהו התיישב שם הרגע.',
  'err.name': 'צריך להזין שם.',
  'err.amount': 'צריך להזין סכום.',
  'err.notAllowed': 'רק המארח יכול לעשות את זה.',
  'err.ended': 'המשחק הסתיים.',
  'err.hasBuyIns': 'אי אפשר להסיר שחקן עם כניסות. קודם מבטלים אותן.',

  'stats.title': 'משחקים קודמים',
  'stats.leaderboard': 'מאז ומעולם',
  'stats.games': '{n} משחקים',
  'stats.game1': 'משחק אחד',
  'stats.none': 'משחקים שהסתיימו יופיעו כאן.',
  'stats.delete': 'מחיקה',
  'stats.clearConfirm': 'למחוק את המשחק מההיסטוריה?',

  'common.cancel': 'ביטול',
  'common.close': 'סגירה',
  'common.confirm': 'אישור',
  'common.chips': '{chips} ז׳יטונים',
};

const dict = { en, he };
let current = 'en';

export function initLang() {
  let saved = null;
  try {
    saved = localStorage.getItem('felt:lang');
  } catch {}
  const guess = (navigator.language || '').toLowerCase().startsWith('he') ? 'he' : 'en';
  setLang(saved === 'he' || saved === 'en' ? saved : guess);
}

export function setLang(code) {
  current = code;
  document.documentElement.lang = code;
  document.documentElement.dir = code === 'he' ? 'rtl' : 'ltr';
  try {
    localStorage.setItem('felt:lang', code);
  } catch {}
}

export function lang() {
  return current;
}

export function t(key, vars = {}) {
  const s = dict[current][key] ?? en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

const locale = () => (current === 'he' ? 'he-IL' : 'en-US');

export function money(cents, currency, { sign = false } = {}) {
  const whole = cents % 100 === 0;
  const s = new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
    signDisplay: sign ? 'exceptZero' : 'auto',
  }).format(cents / 100);
  return s;
}

export function chips(n) {
  const rounded = Math.round(n * 100) / 100;
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(rounded);
}

export function duration(ms) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (current === 'he') return h ? `${h}:${String(m).padStart(2, '0')} ש׳` : `${m} דק׳`;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function clock(ts) {
  return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(ts);
}

export function date(ts) {
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(ts);
}

export function currencySymbol(currency) {
  return (
    new Intl.NumberFormat(locale(), { style: 'currency', currency })
      .formatToParts(0)
      .find((p) => p.type === 'currency')?.value ?? currency
  );
}
