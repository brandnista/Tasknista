/**
 * Pronista §Membership — รายการสั่งซื้อค่าสมาชิก (Submenu ใน "จัดการสมาชิก")
 */
import { Link } from 'react-router'
import { PageHeader } from '../components/PageHeader'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'

interface OrderRow { id: string; memberId: string; memberName: string | null; feeSatang: number; orderedAt: number; status: 'pending' | 'paid' | 'cancelled' }

const fmtBaht = (satang: number) => (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 0 })
const STATUS_LABEL: Record<OrderRow['status'], string> = { pending: 'รอชำระ', paid: 'ชำระแล้ว', cancelled: 'ยกเลิก' }
const STATUS_BADGE: Record<OrderRow['status'], string> = { pending: 'bg-warning-50 text-warning-700', paid: 'bg-success-50 text-success-700', cancelled: 'bg-hover text-muted' }

export function MemberOrdersPage() {
  const { data: orders } = useLoad<OrderRow[]>(() => api.get('/api/member-orders'))

  return (
    <>
      <PageHeader title="รายการสั่งซื้อ" />
      <div className="p-4 sm:p-6">
        <div className="bg-white rounded-lg shadow-xs overflow-hidden">
          {!orders ? (
            <div className="p-8 text-center text-sm text-muted">กำลังโหลด…</div>
          ) : orders.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted">ยังไม่มีรายการสั่งซื้อ — สร้างได้จากหน้ารายละเอียดสมาชิก</div>
          ) : (
            // Pronista §Mobile horizontal-scroll fix (2026-09-02) — เดิมไม่มี overflow-x-auto เลย ตารางยอดเงิน/สถานะ ถูกบีบ/ล้นจอมือถือ
            <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead className="bg-hover text-dim text-xs">
                <tr>
                  <th className="text-left font-medium px-5 py-3">สมาชิก</th>
                  <th className="text-left font-medium px-3 py-3">วันที่สั่งซื้อ</th>
                  <th className="text-right font-medium px-3 py-3">ยอดเงิน</th>
                  <th className="text-left font-medium px-3 py-3">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="px-5 py-3">
                      <Link to={`/members/${o.memberId}`} className="text-brand-700 hover:underline">{o.memberName ?? '—'}</Link>
                    </td>
                    <td className="px-3 text-muted">{new Date(o.orderedAt).toLocaleDateString('th-TH')}</td>
                    <td className="px-3 text-right tabular-nums">{fmtBaht(o.feeSatang)} บาท</td>
                    <td className="px-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_BADGE[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
