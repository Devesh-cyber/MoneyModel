// Coach guardrails: the coach educates and models scenarios, but never recommends
// specific securities (stocks, funds, ETFs, crypto, IPOs). Used on the server before
// calling the AI and again on the AI's answer.

export const GUARDRAIL_MESSAGE =
  "I can't recommend specific stocks, mutual funds, ETFs or crypto — that needs a SEBI-registered investment adviser who knows your full situation. " +
  'What I can do: explain how options like index funds, FDs or PPF generally work, how to compare costs and risk, and model how much you could set aside each month.';

const ASSET_WORDS = '(stocks?|shares?|equit(y|ies)|mutual\\s*funds?|\\bmfs?\\b|\\bsips?\\b\\s+in|etfs?|crypto(currency)?|bitcoin|ethereum|\\bcoins?\\b|ipos?|smallcap|midcap|largecap|flexi\\s*cap|bluechip|fund|scheme|nifty|sensex|f&o|options|futures)';

const FUND_HOUSES = '(HDFC|SBI|ICICI|Axis|Nippon|Parag\\s*Parikh|PPFAS|Mirae|Kotak|Quant|UTI|Tata|Aditya\\s*Birla|DSP|Franklin|Motilal|Canara\\s*Robeco|Edelweiss|Invesco|Bandhan|HSBC|Groww|Navi|Zerodha)';
const TICKERS = '(RELIANCE|TCS|INFY|INFOSYS|HDFCBANK|ICICIBANK|SBIN|ITC|LT|WIPRO|HCLTECH|BAJFINANCE|ADANI\\w*|TATAMOTORS|ASIANPAINT|MARUTI|SUNPHARMA|ZOMATO|PAYTM|NYKAA|TITAN|BHARTIARTL|BTC|ETH|DOGE|SOL)';

const ADVICE_REQUEST = [
  new RegExp(`\\b(which|what|best|top|recommend|suggest|good|tips?|should i (buy|invest|sell|pick|choose|get))\\b[^?.!]{0,60}${ASSET_WORDS}`, 'i'),
  new RegExp(`${ASSET_WORDS}[^?.!]{0,40}\\b(should i|to buy|to pick|to invest in|recommend|best)\\b`, 'i'),
  new RegExp(`\\b(buy|sell|invest in|short)\\b[^?.!]{0,30}\\b${TICKERS}\\b`, 'i'),
];

export function isSecuritiesRequest(question) {
  const q = String(question || '');
  return ADVICE_REQUEST.some((re) => re.test(q));
}

const SPECIFIC_PRODUCT = [
  new RegExp(`\\b${FUND_HOUSES}\\s+[A-Za-z ]{0,30}\\b(fund|flexi\\s*cap|mid\\s*cap|small\\s*cap|large\\s*cap|bluechip|index|etf|scheme|elss)\\b`, 'i'),
  new RegExp(`\\b(buy|invest in|pick|go for|consider|accumulate|add)\\b[^.]{0,40}\\b${TICKERS}\\b`, 'i'),
  /\b(NSE|BSE)\s*:\s*[A-Z]{2,}/,
  /\b[A-Z]{2,12}\.(NS|BO)\b/,
  /\b(target price|stop[- ]loss|multibagger|will (go|rise|double))\b/i,
];

/** Remove sentences that name a specific security to buy. */
export function filterAdvice(text) {
  const sentences = String(text || '').split(/(?<=[.!?])\s+|\n+/);
  let flagged = false;
  const kept = sentences.map((s) => {
    if (SPECIFIC_PRODUCT.some((re) => re.test(s))) { flagged = true; return null; }
    return s;
  }).filter((s) => s !== null && s.trim());
  let out = kept.join(' ').trim();
  if (flagged) out = (out ? out + ' ' : '') + '(I removed a mention of a specific investment product — I can only explain general options, not recommend securities.)';
  return { text: out, flagged };
}
