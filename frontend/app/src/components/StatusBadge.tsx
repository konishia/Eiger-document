import { STATUS_COLORS, STATUS_LABELS, type InquiryStatus } from '@/lib/api';

export default function StatusBadge({ status }: { status: InquiryStatus }) {
  return <span className={`chip ${STATUS_COLORS[status]}`}>{STATUS_LABELS[status]}</span>;
}
