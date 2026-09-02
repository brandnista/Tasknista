/**
 * Pronista §Membership — ประวัติการชำระเงินค่าสมาชิก (Submenu ใน "จัดการสมาชิก")
 */
import { Link } from 'react-router'
import { PageHeader } from '../components/PageHeader'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'

interface PaymentRow { id: string; memberId: string; memberName: string | null; orderId: string; amountSatang: number; paidAt: number; method: string | null; status: 'success' | 'failed' | 'refunded' }

const fmtBaht = (satang: number) => (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 0 })
const STATUS_LABEL: Record<PaymentRow['status'], string> = { success: 'สำเร็จ', failed: 'ล้มเหลว', refunded: 'คืนเงิน' }
const STATUS_BADGE: Record<PaymentRow['status'], string> = { success: 'bg-success-50 text-success-700', failed: 'bg-danger-50 text-danger-700', refunded: 'bg-hover text-muted' }

export function MemberPaymentsPage() {
  const { data: payments } = useLoad<PaymentRow[]>(() => api.get('/api/member-payments'))

  return (
    <>
      <PageHeader title="รายการชำระเงิน" />
      <div className="p-3 sm:p-6">
        <div className="bg-white rounded-lg shadow-xs overflow-hidden">
          {!payments ? (
            <div className="p-8 text-center text-sm text-muted">กำลังโหลด…</div>
          ) : payments.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted">ยังไม่มีประวัติการชำระเงิน</div>
          ) : (
            // Pronista §Mobile horizontal-scroll fix (2026-09-02) — เดิมไม่มี overflow-x-auto เลย ตารางเงินคอลัมน์ยอด/ช่องทาง/สถานะ ถูกบีบ/ล้นจอมือถือ
            <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead className="bg-hover text-dim text-xs">
                <tr>
                  <th className="text-left font-medium px-5 py-3">สมาชิก</th>
                  <th className="text-left font-medium px-3 py-3">วันที่ชำระ</th>
                  <th className="text-right font-medium px-3 py-3">ยอดเงิน</th>
                  <th className="text-left font-medium px-3 py-3">ช่องทาง</th>
                  <th className="text-left font-medium px-3 py-3">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-5 py-3">
                      <Link to={`/members/${p.memberId}`} className="text-brand-700 hover:underline">{p.memberName ?? '—'}</Link>
                    </td>
                    <td className="px-3 text-muted">{new Date(p.paidAt).toLocaleDateString('th-TH')}</td>
                    <td className="px-3 text-right tabular-nums">{fmtBaht(p.amountSatang)} บาท</td>
                    <td className="px-3 text-muted">{p.method ?? '—'}</td>
                    <td className="px-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_BADGE[p.status]}`}>{STATUS_LABEL[p.status]}</span>
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
