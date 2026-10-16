import React from 'react';
import type { Attendance } from '../services/api';

const WORKED = ['PRESENT', 'WFH', 'ON_DUTY', 'CLIENT_VISIT', 'BUSINESS_TRAVEL'];

/** Chip colours shared with the desktop attendance table. */
export const attendanceStatusClasses = (status: string) =>
  WORKED.includes(status)
    ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
    : status === 'ABSENT'
      ? 'bg-red-50 text-red-600 border-red-100'
      : status === 'HOLIDAY'
        ? 'bg-blue-50 text-blue-600 border-blue-100'
        : status === 'ON_LEAVE'
          ? 'bg-purple-50 text-purple-600 border-purple-100'
          : 'bg-slate-50 text-slate-600 border-slate-100';

const shortStatus = (record: Attendance) =>
  record.status === 'HOLIDAY' && record.holidayName
    ? record.holidayName
    : record.status === 'ON_LEAVE' && record.leaveType
      ? record.leaveType
      : record.status === 'WFH'
        ? 'WFH'
        : record.status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());

const hhmm = (time: string | null) => (time ? time.slice(0, 5) : null);

/**
 * Phone version of the attendance log: one row per day (date, punches, status) instead of an
 * eight-column table that doesn't fit. Desktop keeps the table.
 */
export const AttendanceDayList: React.FC<{ records: Attendance[] }> = ({ records }) => (
  <ul className="divide-y divide-orange-100/40">
    {records.map(record => {
      const date = new Date(`${record.date.slice(0, 10)}T00:00:00Z`);
      const checkIn = hhmm(record.checkIn);
      const checkOut = hhmm(record.checkOut);
      const notes = [
        record.isLate && `Late ${record.lateBy ?? ''}`.trim(),
        !record.isLate && record.isGraceLate && 'Grace late',
        record.overtime && `OT ${hhmm(record.otTime) ?? ''}`.trim(),
      ].filter(Boolean) as string[];

      return (
        <li key={`${record.id || record.date}`} className="py-3 flex items-center gap-3">
          <div className="w-11 flex-shrink-0 text-center">
            <p className="text-lg font-black text-slate-800 leading-none tabular-nums">{date.getUTCDate()}</p>
            <p className="text-[10px] font-bold uppercase text-slate-400 mt-0.5">
              {date.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })}
            </p>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-700 tabular-nums">
              {checkIn ? `${checkIn} – ${checkOut ?? '…'}` : <span className="text-slate-400">No punch</span>}
              {record.totalWorkingHours && <span className="text-slate-400 font-medium"> · {hhmm(record.totalWorkingHours)}h</span>}
            </p>
            {notes.length > 0 && (
              <p className="text-[11px] font-bold text-orange-600 mt-0.5 truncate">{notes.join(' · ')}</p>
            )}
          </div>
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border max-w-[45%] truncate flex-shrink-0 ${attendanceStatusClasses(record.status)}`}>
            {shortStatus(record)}
          </span>
        </li>
      );
    })}
  </ul>
);
