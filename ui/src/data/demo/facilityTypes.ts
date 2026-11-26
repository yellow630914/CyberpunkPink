/**
 * 舊設施的 id → 它的設施種類（world.ts 的 typeOf 用它）。獨立一個沒有 import 的小檔，免得 world.ts 與 parts.ts、auction.ts 互相引用。
 * 天井市場的零件攤是同人社團的委託台（unreg_desk，parts.ts）；玻璃岸俱樂部街的「拍賣行『白槌』」是 auction（auction.ts）。
 */
export const PARTS_FACILITY_TYPE: Record<string, string> = { parts: 'fac_unreg_desk' }
export const AUCTION_FACILITY_TYPE: Record<string, string> = { auction: 'fac_auction' }
