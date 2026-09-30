'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { foundationArabic } from './i18n-foundation';
import { catalogueArabic, translateCatalogueText } from './i18n-catalogue';
import { importArabic, translateImportText } from './i18n-import';

export type Language = 'en' | 'ar';

export type TranslationKey = string;

const translations: Record<Language, Record<string, string>> = {
  en: {
    'app.subjectReservation': 'Subject Reservation',
    'common.user': 'User',
    'common.signOut': 'Sign Out',
    'common.loading': 'Loading...',
    'common.noData': 'No data found.',
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.results': 'Results',
    'common.rows': 'rows',
    'common.row': 'row',
    'common.csv': 'CSV',
    'language.english': 'English',
    'language.arabic': 'Arabic',
    'language.switchTo': 'Switch language',
    'nav.dashboard': 'Dashboard',
    'nav.management': 'Management',
    'nav.sessions': 'Sessions',
    'nav.subjects': 'Subjects',
    'nav.payments': 'Payments',
    'nav.escrow': 'Escrow',
    'nav.finance': 'Finance',
    'nav.financeWorkbench': 'Finance Workbench',
    'nav.schoolFees': 'School Fees',
    'nav.schoolFee': 'School Fee',
    'nav.announcements': 'Announcements',
    'nav.exceptions': 'Exceptions',
    'nav.remarks': 'Remarks',
    'nav.desk': 'The Desk',
    'nav.dailyTakings': 'Daily Takings',
    'nav.team': 'Team',
    'nav.remarksDesk': 'Remarks Desk',
    'nav.resultsEntry': 'Results Entry',
    'nav.oversight': 'Oversight',
    'nav.reports': 'Reports',
    'nav.auditLog': 'Audit Log',
    'nav.notifications': 'Notifications',
    'nav.home': 'Home',
    'nav.registration': 'Registration',
    'nav.registerSubjects': 'Register Subjects',
    'nav.myRegistrations': 'My Registrations',
    'nav.history': 'History',
    'nav.approvals': 'Approvals',
    'nav.financial': 'Financial',
    'nav.escrowBalance': 'Escrow Balance',
    'nav.checkout': 'Checkout',
    'nav.account': 'Account',
    'nav.linkedChildren': 'Linked Children',
    'nav.linkedParents': 'Linked Parents',
    'nav.profile': 'Profile',
    'nav.browseSubjects': 'Browse Subjects',
    'nav.requests': 'Requests',
    'nav.pendingRequests': 'Pending Requests',
    'nav.academic': 'Academic',
    'nav.school': 'School',
    'nav.today': 'Today',
    'nav.students': 'Students',
    'nav.sections': 'Sections',
    'nav.academicYear': 'Academic Year',
    'nav.calendar': 'Calendar',
    'nav.bellSchedules': 'Bell Schedules',
    'nav.rooms': 'Rooms',
    'nav.settings': 'Settings',
    'nav.myTeaching': 'My Teaching',
    'nav.enrolment': 'Course Enrolment',
    'nav.exams': 'Exams',
    'nav.catalogue': 'Exam Catalogue',
    'nav.boardSeries': 'Board Series',
    'nav.import': 'Day-one Import',
    'reports.title': 'Reports',
    'reports.description': 'Generate and export data reports. All reports support CSV download.',
    'reports.pendingApprovals': 'Pending Approvals',
    'reports.registrations': 'Registration Report',
    'reports.financial': 'Financial Summary',
    'reports.enrollment': 'Subject Enrollment',
    'reports.compliance': 'Grade 10 Compliance',
    'reports.roster': 'Student Roster',
    'reports.escrow': 'Escrow Report',
    'reports.comprehensive': 'Comprehensive Staff Analytics',
    'reports.comprehensiveDescription': 'A broad report pack covering users, sessions, subjects, approvals, payments, escrow, notifications, audit activity, and operational queues.',
    'reports.registrationRequests': 'Registration Requests',
    'reports.dropSwapRequests': 'Drop / Swap Requests',
    'reports.coreSubjects': 'Core subjects',
    'reports.noneDefined': 'None defined',
    'reports.student': 'Student',
    'reports.studentId': 'Student ID',
    'reports.compliant': 'Compliant',
    'reports.perSubjectStatus': 'Per-subject status',
    'reports.noGrade10': 'No Grade 10 students in this session.',
    'reports.session': 'Session',
    'reports.selectSession': 'Select a session...',
    'reports.grade': 'Grade',
    'reports.allGrades': 'All grades',
    'reports.grade10': 'Grade 10',
    'reports.grade11': 'Grade 11',
    'reports.grade12': 'Grade 12',
    'reports.graduated': 'Graduated',
    'reports.run': 'Run Report',
    'reports.generating': 'Generating report...',
    'reports.failed': 'Failed to generate report. Check your filters and try again.',
    'reports.summary': 'Summary',
    'reports.section': 'Section',
    'dashboard.title': 'Admin Dashboard',
    'dashboard.lastUpdated': 'Last updated',
    'dashboard.actionRequired': 'Action Required',
    'dashboard.pendingApprovals': 'Pending Approvals',
    'dashboard.registrationRequests': 'Registration requests',
    'dashboard.pendingPayments': 'Pending Payments',
    'dashboard.awaitingParentPayment': 'Awaiting parent payment',
    'dashboard.changeRequests': 'Change Requests',
    'dashboard.dropSwapRequests': 'Drop / swap requests',
    'dashboard.bankTransfers': 'Bank Transfers',
    'dashboard.manualConfirmationNeeded': 'Manual confirmation needed',
    'dashboard.withdrawals': 'Withdrawals',
    'dashboard.total': 'total',
    'dashboard.currentSessions': 'Current Sessions',
    'dashboard.currentSession': 'Current Session',
    'dashboard.activeSessions': 'Active Sessions',
    'dashboard.noneOpen': 'None open',
    'dashboard.registrationsCurrent': 'Registrations (Current)',
    'dashboard.inActiveSessions': 'In active session(s)',
    'dashboard.revenueCurrent': 'Revenue (Current)',
    'dashboard.confirmedPayments': 'Confirmed payments',
    'dashboard.confirmedThisMonth': 'Confirmed This Month',
    'dashboard.registrationsConfirmed': 'Registrations confirmed',
    'dashboard.overview': 'Overview',
    'dashboard.escrowLiability': 'Escrow Liability',
    'dashboard.totalPositiveBalances': 'Total positive balances',
    'dashboard.activeStudents': 'Active Students',
    'dashboard.excludingGraduated': 'Excluding graduated',
    'dashboard.totalParents': 'Total Parents',
    'dashboard.pendingWithdrawals': 'Pending Withdrawals',
    'dashboard.studentsByGrade': 'Students by Grade',
    'dashboard.gradeUpcoming': 'Grade 9 (next year)',
    'dashboard.gradeUnknown': 'Grade not recorded',
    'dashboard.leftSchool': 'Left the school',
    'dashboard.fixOnStudents': 'Record on the Students page',
    'dashboard.pendingApprovalsDescription': 'Registration requests + drop/swap requests awaiting parent approval',
    'dashboard.fullReport': 'Full report',
    'dashboard.loadingPendingApprovals': 'Loading pending approvals...',
    'dashboard.allApprovalsUpToDate': 'All approvals are up to date',
    'dashboard.type': 'Type',
    'dashboard.student': 'Student',
    'dashboard.subject': 'Subject',
    'dashboard.session': 'Session',
    'dashboard.amount': 'Amount',
    'dashboard.waiting': 'Waiting',
    'dashboard.daysShort': 'd',
    'dashboard.registration': 'Registration',
    'dashboard.drop': 'Drop',
    'dashboard.swap': 'Swap',
  },
  ar: {
    'nav.academic': 'الشؤون الأكاديمية',
    'nav.school': 'المدرسة',
    'nav.today': 'اليوم',
    'nav.students': 'الطلاب',
    'nav.sections': 'الفصول',
    'nav.academicYear': 'العام الدراسي',
    'nav.calendar': 'التقويم',
    'nav.bellSchedules': 'مواعيد الحصص',
    'nav.rooms': 'القاعات',
    'nav.settings': 'الإعدادات',
    'nav.myTeaching': 'تدريسي',
    'nav.enrolment': 'الالتحاق بالمقررات',
    'nav.exams': 'الامتحانات',
    'nav.catalogue': 'دليل الامتحانات',
    'nav.boardSeries': 'دورات المجالس',
    'nav.import': 'الاستيراد الأول',
    'app.subjectReservation': 'حجز المواد',
    'common.user': 'مستخدم',
    'common.signOut': 'تسجيل الخروج',
    'common.loading': 'جار التحميل...',
    'common.noData': 'لا توجد بيانات.',
    'common.yes': 'نعم',
    'common.no': 'لا',
    'common.results': 'النتائج',
    'common.rows': 'صفوف',
    'common.row': 'صف',
    'common.csv': 'CSV',
    'language.english': 'الإنجليزية',
    'language.arabic': 'العربية',
    'language.switchTo': 'تغيير اللغة',
    'nav.dashboard': 'لوحة التحكم',
    'nav.management': 'الإدارة',
    'nav.sessions': 'الجلسات',
    'nav.subjects': 'المواد',
    'nav.payments': 'المدفوعات',
    'nav.escrow': 'الرصيد',
    'nav.finance': 'المالية',
    'nav.financeWorkbench': 'مكتب المالية',
    'nav.schoolFees': 'المصاريف الدراسية',
    'nav.schoolFee': 'المصاريف الدراسية',
    'nav.announcements': 'الإعلانات',
    'nav.exceptions': 'الاستثناءات',
    'nav.remarks': 'إعادة التصحيح',
    'nav.desk': 'المكتب',
    'nav.dailyTakings': 'إيرادات اليوم',
    'nav.team': 'الفريق',
    'nav.remarksDesk': 'مكتب إعادة التصحيح',
    'nav.resultsEntry': 'إدخال النتائج',
    'nav.oversight': 'المتابعة',
    'nav.reports': 'التقارير',
    'nav.auditLog': 'سجل التدقيق',
    'nav.notifications': 'الإشعارات',
    'nav.home': 'الرئيسية',
    'nav.registration': 'التسجيل',
    'nav.registerSubjects': 'تسجيل المواد',
    'nav.myRegistrations': 'تسجيلاتي',
    'nav.history': 'السجل',
    'nav.approvals': 'الموافقات',
    'nav.financial': 'المالية',
    'nav.escrowBalance': 'رصيد الحساب',
    'nav.checkout': 'الدفع',
    'nav.account': 'الحساب',
    'nav.linkedChildren': 'الأبناء المرتبطون',
    'nav.linkedParents': 'أولياء الأمور المرتبطون',
    'nav.profile': 'الملف الشخصي',
    'nav.browseSubjects': 'تصفح المواد',
    'nav.requests': 'الطلبات',
    'nav.pendingRequests': 'الطلبات المعلقة',
    'reports.title': 'التقارير',
    'reports.description': 'إنشاء وتصدير تقارير البيانات. جميع التقارير تدعم تنزيل CSV.',
    'reports.pendingApprovals': 'الموافقات المعلقة',
    'reports.registrations': 'تقرير التسجيل',
    'reports.financial': 'الملخص المالي',
    'reports.enrollment': 'الالتحاق بالمواد',
    'reports.compliance': 'التزام الصف العاشر',
    'reports.roster': 'قائمة الطلاب',
    'reports.escrow': 'تقرير الرصيد',
    'reports.comprehensive': 'تحليلات شاملة للموظفين',
    'reports.comprehensiveDescription': 'حزمة تقارير واسعة تغطي المستخدمين والجلسات والمواد والموافقات والمدفوعات والأرصدة والإشعارات وسجل التدقيق وقوائم العمل.',
    'reports.registrationRequests': 'طلبات التسجيل',
    'reports.dropSwapRequests': 'طلبات الحذف / التبديل',
    'reports.coreSubjects': 'المواد الأساسية',
    'reports.noneDefined': 'لا يوجد',
    'reports.student': 'الطالب',
    'reports.studentId': 'رقم الطالب',
    'reports.compliant': 'ملتزم',
    'reports.perSubjectStatus': 'حالة كل مادة',
    'reports.noGrade10': 'لا يوجد طلاب في الصف العاشر لهذه الجلسة.',
    'reports.session': 'الجلسة',
    'reports.selectSession': 'اختر جلسة...',
    'reports.grade': 'الصف',
    'reports.allGrades': 'كل الصفوف',
    'reports.grade10': 'الصف 10',
    'reports.grade11': 'الصف 11',
    'reports.grade12': 'الصف 12',
    'reports.graduated': 'متخرج',
    'reports.run': 'تشغيل التقرير',
    'reports.generating': 'جار إنشاء التقرير...',
    'reports.failed': 'تعذر إنشاء التقرير. راجع عوامل التصفية وحاول مرة أخرى.',
    'reports.summary': 'الملخص',
    'reports.section': 'القسم',
    'dashboard.title': 'لوحة تحكم الإدارة',
    'dashboard.lastUpdated': 'آخر تحديث',
    'dashboard.actionRequired': 'إجراءات مطلوبة',
    'dashboard.pendingApprovals': 'الموافقات المعلقة',
    'dashboard.registrationRequests': 'طلبات التسجيل',
    'dashboard.pendingPayments': 'مدفوعات معلقة',
    'dashboard.awaitingParentPayment': 'بانتظار دفع ولي الأمر',
    'dashboard.changeRequests': 'طلبات التغيير',
    'dashboard.dropSwapRequests': 'طلبات حذف / تبديل',
    'dashboard.bankTransfers': 'التحويلات البنكية',
    'dashboard.manualConfirmationNeeded': 'تحتاج تأكيد يدوي',
    'dashboard.withdrawals': 'السحوبات',
    'dashboard.total': 'إجمالي',
    'dashboard.currentSessions': 'الجلسات الحالية',
    'dashboard.currentSession': 'الجلسة الحالية',
    'dashboard.activeSessions': 'الجلسات النشطة',
    'dashboard.noneOpen': 'لا توجد جلسات مفتوحة',
    'dashboard.registrationsCurrent': 'التسجيلات الحالية',
    'dashboard.inActiveSessions': 'في الجلسات النشطة',
    'dashboard.revenueCurrent': 'الإيراد الحالي',
    'dashboard.confirmedPayments': 'مدفوعات مؤكدة',
    'dashboard.confirmedThisMonth': 'المؤكد هذا الشهر',
    'dashboard.registrationsConfirmed': 'تسجيلات مؤكدة',
    'dashboard.overview': 'نظرة عامة',
    'dashboard.escrowLiability': 'التزامات الأرصدة',
    'dashboard.totalPositiveBalances': 'إجمالي الأرصدة الموجبة',
    'dashboard.activeStudents': 'الطلاب النشطون',
    'dashboard.excludingGraduated': 'باستثناء المتخرجين',
    'dashboard.totalParents': 'إجمالي أولياء الأمور',
    'dashboard.pendingWithdrawals': 'سحوبات معلقة',
    'dashboard.studentsByGrade': 'الطلاب حسب الصف',
    'dashboard.gradeUpcoming': 'الصف 9 (العام القادم)',
    'dashboard.gradeUnknown': 'الصف غير مسجل',
    'dashboard.leftSchool': 'غادروا المدرسة',
    'dashboard.fixOnStudents': 'سجّله من صفحة الطلاب',
    'dashboard.pendingApprovalsDescription': 'طلبات التسجيل وطلبات الحذف/التبديل التي تنتظر موافقة ولي الأمر',
    'dashboard.fullReport': 'التقرير الكامل',
    'dashboard.loadingPendingApprovals': 'جار تحميل الموافقات المعلقة...',
    'dashboard.allApprovalsUpToDate': 'كل الموافقات محدثة',
    'dashboard.type': 'النوع',
    'dashboard.student': 'الطالب',
    'dashboard.subject': 'المادة',
    'dashboard.session': 'الجلسة',
    'dashboard.amount': 'المبلغ',
    'dashboard.waiting': 'الانتظار',
    'dashboard.daysShort': 'يوم',
    'dashboard.registration': 'تسجيل',
    'dashboard.drop': 'حذف',
    'dashboard.swap': 'تبديل',
  },
};

const autoArabicText: Record<string, string> = {
  // ── V3 desk / finance / remarks screens (UX audit: Arabic coverage) ──
  'Candidate Consent': 'موافقة الطالب',
  'I consent on behalf of the candidate': 'أوافق نيابة عن الطالب',
  'Post-results re-mark requests, per paper. Grades can go up, down, or stay the same.': 'طلبات إعادة تصحيح بعد النتائج، لكل ورقة امتحان. قد ترتفع الدرجة أو تنخفض أو تبقى كما هي.',
  'Subject (resulted)': 'المادة (ظهرت نتيجتها)',
  'Pick a subject with a recorded result…': 'اختر مادة تم تسجيل نتيجتها…',
  'No subjects with recorded results yet — remarks open after results day.': 'لا توجد مواد بنتائج مسجلة بعد — تُفتح طلبات إعادة التصحيح بعد ظهور النتائج.',
  'Service': 'الخدمة',
  'Papers': 'أوراق الامتحان',
  '+ Add Paper': '+ إضافة ورقة',
  'Pay Remark Fee': 'دفع رسوم إعادة التصحيح',
  'Board reference': 'رقم مرجع المجلس',
  'Awaiting submission to board': 'في انتظار الإرسال للمجلس',
  'Submitted — awaiting board outcome': 'تم الإرسال — في انتظار نتيجة المجلس',
  'Remark fees (per paper)': 'رسوم إعادة التصحيح (لكل ورقة)',
  'Unchanged': 'دون تغيير',
  'Mark up': 'رفع الدرجة',
  'Mark down': 'خفض الدرجة',
  'New grade': 'الدرجة الجديدة',
  'The annual school fee unlocks subject registration for the school year.': 'المصاريف الدراسية السنوية تفتح تسجيل المواد لهذا العام.',
  'Payment method': 'طريقة الدفع',
  'Transaction reference from your InstaPay receipt': 'رقم العملية من إيصال إنستاباي',
  'InstaPay transaction reference': 'رقم عملية إنستاباي',
  'Go to Registration': 'الذهاب إلى التسجيل',
  'Not open yet': 'لم يُفتح بعد',
  'Manage Links': 'إدارة الروابط',
  'Payment initiated': 'تم بدء الدفع',
  'Paid': 'مدفوع',
  'Due': 'مستحق',
  'Bank': 'البنك',
  'Exact Amount': 'المبلغ بالضبط',
  'Must be returned': 'يجب إرجاعه',
  'Hand to parent': 'تسليم لولي الأمر',
  'Reference submitted': 'تم إرسال رقم العملية',
  'Parent has not submitted a transfer reference yet': 'لم يرسل ولي الأمر رقم التحويل بعد',
  'Partially released': 'تم صرف جزء منه',
  'Cash released — approval pending': 'تم صرف المبلغ — في انتظار الاعتماد',
  'Awaiting finance-admin approval': 'في انتظار اعتماد مدير المالية',
  'Amount released (EGP)': 'المبلغ المصروف (ج.م)',
  'Record Release': 'تسجيل الصرف',
  'Reject Withdrawal': 'رفض طلب السحب',
  'Lost': 'مفقود',
  'Mark Lost': 'تسجيل كمفقود',
  'Write this receipt off as lost?': 'تسجيل هذا الإيصال كمفقود؟',
  'Reverse Payment': 'عكس عملية الدفع',
  'Reverse this payment?': 'عكس عملية الدفع هذه؟',
  'Reason for the reversal': 'سبب عكس العملية',
  'Working…': 'جارٍ التنفيذ…',
  'No registrations yet.': 'لا توجد تسجيلات بعد.',
  'No payments yet.': 'لا توجد مدفوعات بعد.',
  'Nothing available (already registered, or level mismatch).': 'لا توجد مواد متاحة (مسجلة بالفعل أو لا تطابق المستوى).',
  'Pick an open session…': 'اختر جلسة تسجيل مفتوحة…',
  'Phone (optional)': 'رقم الهاتف (اختياري)',
  'Paid with': 'تم الدفع بـ',
  'Outside school': 'خارج المدرسة',
  'Everything confirmed on this day — reconcile the cash drawer against it.': 'كل ما تم تأكيده في هذا اليوم — طابق درج النقدية عليه.',
  'Money out': 'المنصرف',
  'Net in drawer': 'صافي الدرج',
  'Instrument': 'وسيلة الدفع',
  'Cash refund': 'استرداد نقدي',
  'What needs you': 'ما يحتاج إلى إجرائك',
  'Total outstanding': 'إجمالي المستحق',
  'Start by linking your child': 'ابدأ بربط حساب ابنك/ابنتك',
  'Link my child →': 'ربط ابني/ابنتي ←',
  'Temp. password': 'كلمة مرور مؤقتة',
  'Export Grid': 'تصدير الجدول',
  'Could not load this': 'تعذر تحميل هذه البيانات',
  // V3 desk & finance screens (UX_AUDIT G13)
  'The Desk': 'المكتب',
  'Find a student — see everything, do everything, in one place.': 'ابحث عن طالب — شاهد كل شيء ونفّذ كل شيء من مكان واحد.',
  '+ New Family (Onboard)': '+ عائلة جديدة (تسجيل)',
  'Onboard a walk-in family': 'تسجيل عائلة حاضرة في المدرسة',
  'Create & Link Family': 'إنشاء وربط العائلة',
  'Register subjects at the desk': 'تسجيل المواد من المكتب',
  'Money received now (confirms immediately and creates the receipts)': 'تم استلام المبلغ الآن (تأكيد فوري وإصدار الإيصالات)',
  'Owes now': 'المستحق الآن',
  'Registrations': 'التسجيلات',
  'Recent payments': 'المدفوعات الأخيرة',
  'Hand Over': 'تسليم',
  'Take Back': 'استرجاع',
  'Print': 'طباعة',
  'Print Receipt': 'طباعة الإيصال',
  'Reverse': 'عكس العملية',
  'Finance Workbench': 'مكتب المالية',
  'Payments to confirm': 'مدفوعات للتأكيد',
  'Receipts': 'الإيصالات',
  'Cash refunds to hand out': 'مبالغ نقدية للاسترداد',
  'How did they pay?': 'كيف تم الدفع؟',
  'Mark Handed Over': 'تم التسليم',
  'Mark Returned': 'تم الاسترجاع',
  'Release Cash': 'صرف المبلغ',
  'Daily Takings': 'إيرادات اليوم',
  'Money in': 'الإيرادات',
  'By instrument': 'حسب وسيلة الدفع',
  'Team & Accounts': 'الفريق والحسابات',
  'Create Account': 'إنشاء حساب',
  'Results Entry': 'إدخال النتائج',
  'Paste from Excel': 'لصق من إكسل',
  'Fill Grid': 'تعبئة الجدول',
  'Remarks': 'إعادة التصحيح',
  'Remarks Desk': 'مكتب إعادة التصحيح',
  'New Remark Request': 'طلب إعادة تصحيح جديد',
  'Give Consent': 'إعطاء الموافقة',
  'Pay Fee': 'دفع الرسوم',
  'Record Outcome': 'تسجيل النتيجة',
  'Mark Submitted': 'تم الإرسال',
  'School Fee': 'المصاريف الدراسية',
  'Pay at School': 'الدفع في المدرسة',
  'InstaPay': 'إنستاباي',
  'Pay at the School Finance Desk': 'ادفع في مكتب المالية بالمدرسة',
  'Submit Reference': 'إرسال رقم العملية',
  'Pay now →': 'ادفع الآن ←',
  'Preregistration': 'تسجيل مسبق',
  'Cancel Preregistration': 'إلغاء التسجيل المسبق',
  'Revert Approval': 'تراجع عن الموافقة',
  'Import CSV': 'استيراد CSV',
  'Export CSV': 'تصدير CSV',
  'Setup needed — parents will hit these before you do': 'إعدادات ناقصة — سيصطدم بها أولياء الأمور قبلكم',
  'Total paid': 'الإجمالي المدفوع',
  'Course fee': 'رسوم التدريس',
  'Registration fee': 'رسوم التسجيل',
  'Grant Exception': 'منح استثناء',
  'Exceptions': 'الاستثناءات',
  // App and auth
  'IGCSE Subjects': 'مواد IGCSE',
  'IGCSE Reservation': 'حجز IGCSE',
  'IGCSE Reserve': 'حجز IGCSE',
  'Your academic journey starts here.': 'رحلتك الأكاديمية تبدأ هنا.',
  'Reserve your IGCSE subjects with confidence. A seamless registration experience built for students and parents.': 'احجز مواد IGCSE بثقة من خلال تجربة تسجيل سهلة للطلاب وأولياء الأمور.',
  'Active Students': 'طلاب نشطون',
  'Satisfaction': 'رضا',
  'Welcome back': 'مرحبًا بعودتك',
  'Sign in to your IGCSE account to manage your subject reservations.': 'سجّل الدخول إلى حساب IGCSE لإدارة حجوزات المواد.',
  'Email address': 'البريد الإلكتروني',
  'Password': 'كلمة المرور',
  'Enter your password': 'أدخل كلمة المرور',
  'Forgot password?': 'نسيت كلمة المرور؟',
  'Sign in': 'تسجيل الدخول',
  'Signing in...': 'جار تسجيل الدخول...',
  "Don't have an account?": 'ليس لديك حساب؟',
  'Create one': 'إنشاء حساب',
  'Create your account': 'إنشاء حسابك',
  'Choose your account type to begin registration.': 'اختر نوع الحساب لبدء التسجيل.',
  'Student': 'طالب',
  'Parent': 'ولي أمر',
  'Continue': 'متابعة',
  'Create Student Account': 'إنشاء حساب طالب',
  'Create Parent Account': 'إنشاء حساب ولي أمر',
  'Full name': 'الاسم الكامل',
  'Email': 'البريد الإلكتروني',
  'Confirm password': 'تأكيد كلمة المرور',
  'Already have an account?': 'لديك حساب بالفعل؟',
  'Verify your email': 'تحقق من بريدك الإلكتروني',
  'Reset password': 'إعادة تعيين كلمة المرور',
  'Forgot your password?': 'نسيت كلمة المرور؟',
  'Send reset link': 'إرسال رابط إعادة التعيين',
  'Back to sign in': 'العودة لتسجيل الدخول',
  'Complete Your Profile': 'أكمل ملفك الشخصي',
  'Select Your Grade': 'اختر صفك',
  'First year of IGCSE': 'السنة الأولى من IGCSE',
  'Second year of IGCSE': 'السنة الثانية من IGCSE',
  'Final year': 'السنة النهائية',
  'Complete Setup': 'إكمال الإعداد',
  'Check your email': 'تحقق من بريدك الإلكتروني',
  'Did not receive the email? Check your spam folder or try again.': 'لم يصلك البريد؟ تحقق من مجلد الرسائل غير المرغوبة أو حاول مرة أخرى.',
  'No worries. Enter your email address and we will send you a link to reset it.': 'لا تقلق. أدخل بريدك الإلكتروني وسنرسل لك رابطًا لإعادة التعيين.',
  'It happens to everyone. We will help you get back into your account quickly and securely.': 'هذا يحدث للجميع. سنساعدك على العودة إلى حسابك بسرعة وأمان.',
  'Failed to send reset email. Please try again.': 'تعذر إرسال بريد إعادة التعيين. حاول مرة أخرى.',
  'Please select your account type': 'يرجى اختيار نوع الحساب',
  'Please select your grade': 'يرجى اختيار الصف',
  'We need your current grade to set up your account correctly.': 'نحتاج إلى صفك الحالي لإعداد حسابك بشكل صحيح.',
  'One more step — tell us your role so we can personalize your experience.': 'خطوة أخيرة: أخبرنا بدورك حتى نخصص تجربتك.',
  'I am a...': 'أنا...',
  'Register for IGCSE subjects and track your progress': 'سجّل مواد IGCSE وتابع تقدمك',
  'Register subjects on behalf of your children': 'سجّل المواد نيابة عن أبنائك',
  'Please select your current grade to continue.': 'يرجى اختيار صفك الحالي للمتابعة.',
  'Current Grade': 'الصف الحالي',
  'Failed to complete setup': 'تعذر إكمال الإعداد',
  'Parent Registration': 'تسجيل ولي أمر',
  "Create your parent account to manage your children's IGCSE registrations.": 'أنشئ حساب ولي أمر لإدارة تسجيلات أبنائك في IGCSE.',
  "Take care of your child's success.": 'اهتم بنجاح ابنك/ابنتك.',
  'Register subjects on their behalf': 'تسجيل المواد نيابة عنهم',
  'Manage escrow and payments': 'إدارة الأرصدة والمدفوعات',
  'Back to account type': 'العودة إلى نوع الحساب',
  'Full Name': 'الاسم الكامل',
  'Email Address': 'البريد الإلكتروني',
  'Enter your full name': 'أدخل اسمك الكامل',
  'At least 8 characters': '8 أحرف على الأقل',
  'Minimum 8 characters required': 'مطلوب 8 أحرف على الأقل',
  'Confirm Password': 'تأكيد كلمة المرور',
  'Confirm your password': 'أكّد كلمة المرور',
  'Passwords do not match': 'كلمتا المرور غير متطابقتين',
  'Password must be at least 8 characters': 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل',
  'Account Created Successfully!': 'تم إنشاء الحساب بنجاح!',
  'Redirecting you to the dashboard...': 'جار تحويلك إلى لوحة التحكم...',
  'Setting up your account...': 'جار إعداد حسابك...',
  'Please wait while we complete your parent profile.': 'يرجى الانتظار بينما نكمل ملف ولي الأمر.',
  'Try again': 'حاول مرة أخرى',
  'The email or password you entered is incorrect. Please check your credentials and try again.': 'البريد الإلكتروني أو كلمة المرور غير صحيحة. تحقق من البيانات وحاول مرة أخرى.',
  'No account found with this email address. Please check the email or create a new account.': 'لا يوجد حساب بهذا البريد الإلكتروني. تحقق من البريد أو أنشئ حسابًا جديدًا.',
  'The password you entered is incorrect. Please try again or reset your password.': 'كلمة المرور غير صحيحة. حاول مرة أخرى أو أعد تعيين كلمة المرور.',
  'Your email address has not been verified yet. Please check your inbox for a verification link.': 'لم يتم التحقق من بريدك الإلكتروني بعد. تحقق من صندوق الوارد لرابط التحقق.',
  'This account has been suspended. Please contact the school administration for assistance.': 'تم إيقاف هذا الحساب. يرجى التواصل مع إدارة المدرسة للمساعدة.',
  'Too many attempts. Please wait a few minutes and try again.': 'محاولات كثيرة جدًا. انتظر بضع دقائق ثم حاول مرة أخرى.',
  'No account found with this email address. You may need to sign up first.': 'لا يوجد حساب بهذا البريد الإلكتروني. قد تحتاج إلى إنشاء حساب أولًا.',
  'An account with this email already exists. Please sign in instead.': 'يوجد حساب بهذا البريد الإلكتروني بالفعل. يرجى تسجيل الدخول بدلًا من ذلك.',
  'Please enter a valid email address.': 'يرجى إدخال بريد إلكتروني صالح.',
  'Your password is too weak. Please use at least 8 characters with a mix of uppercase letters and numbers.': 'كلمة المرور ضعيفة جدًا. استخدم 8 أحرف على الأقل مع مزيج من الأحرف الكبيرة والأرقام.',
  'Password must be at least 8 characters with at least one uppercase letter and one number.': 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل وتحتوي على حرف كبير ورقم.',
  'Unable to reach the server. Please check your internet connection or try again later.': 'تعذر الوصول إلى الخادم. تحقق من اتصال الإنترنت أو حاول لاحقًا.',
  'An unexpected error occurred. Please try again.': 'حدث خطأ غير متوقع. حاول مرة أخرى.',

  // Common actions and states
  'Loading...': 'جار التحميل...',
  'Loading': 'جار التحميل',
  'Saving...': 'جار الحفظ...',
  'Save': 'حفظ',
  'Cancel': 'إلغاء',
  'Close': 'إغلاق',
  'Edit': 'تعديل',
  'Delete': 'حذف',
  'Update': 'تحديث',
  'Create': 'إنشاء',
  'Submit': 'إرسال',
  'Approve': 'موافقة',
  'Reject': 'رفض',
  'Confirm': 'تأكيد',
  'Back': 'رجوع',
  'Next': 'التالي',
  'Previous': 'السابق',
  'Search': 'بحث',
  'Filter': 'تصفية',
  'Clear': 'مسح',
  'All': 'الكل',
  'None': 'لا يوجد',
  'Yes': 'نعم',
  'No': 'لا',
  'Status': 'الحالة',
  'Actions': 'الإجراءات',
  'Details': 'التفاصيل',
  'Name': 'الاسم',
  'Grade': 'الصف',
  'Subject': 'المادة',
  'Subjects': 'المواد',
  'Session': 'الجلسة',
  'Amount': 'المبلغ',
  'Price': 'السعر',
  'Date': 'التاريخ',
  'Type': 'النوع',
  'Reason': 'السبب',
  'Notes': 'ملاحظات',
  'Description': 'الوصف',
  'Total': 'الإجمالي',
  'Subtotal': 'الإجمالي الفرعي',
  'Balance': 'الرصيد',
  'Available': 'المتاح',
  'Pending': 'معلق',
  'Approved': 'موافق عليه',
  'Rejected': 'مرفوض',
  'Confirmed': 'مؤكد',
  'Completed': 'مكتمل',
  'Failed': 'فشل',
  'Draft': 'مسودة',
  'Active': 'نشط',
  'Closed': 'مغلق',
  'Open': 'مفتوح',
  'Required': 'مطلوب',
  'Optional': 'اختياري',
  'pending_approval': 'بانتظار الموافقة',
  'pending_payment': 'بانتظار الدفع',
  'confirmed': 'مؤكد',
  'rejected': 'مرفوض',
  'dropped': 'محذوف',
  'expired': 'منتهي',
  'approved': 'موافق عليه',
  'pending': 'معلق',
  'completed': 'مكتمل',
  'failed': 'فشل',
  'refunded': 'مسترد',
  'fulfilled': 'تم التنفيذ',
  'partially_fulfilled': 'منفذ جزئيًا',
  'draft': 'مسودة',
  'active': 'نشط',
  'closed': 'مغلق',
  'student': 'طالب',
  'parent': 'ولي أمر',
  'admin': 'مشرف',
  'drop': 'حذف',
  'swap': 'تبديل',
  'june': 'يونيو',
  'november': 'نوفمبر',
  'january': 'يناير',
  'card': 'بطاقة',
  'mobile_wallet': 'محفظة إلكترونية',
  'bank_transfer': 'تحويل بنكي',
  'fawry': 'فوري',
  'escrow': 'رصيد',
  'CSV': 'CSV',
  'No data found.': 'لا توجد بيانات.',
  'Unknown': 'غير معروف',
  'Core': 'أساسي',
  'External': 'خارجي',
  'School': 'المدرسة',
  'Non-school': 'خارج المدرسة',
  'Parent note': 'ملاحظة ولي الأمر',
  'Comments': 'تعليقات',
  'Comment': 'تعليق',
  'optional': 'اختياري',
  'Requested by': 'تم الطلب بواسطة',
  'Approved by': 'تمت الموافقة بواسطة',
  'Rejected by': 'تم الرفض بواسطة',
  'Dropped on': 'تم الحذف في',
  'Change Request History': 'سجل طلبات التغيير',
  'Request': 'طلب',
  'Hide': 'إخفاء',
  'Show': 'عرض',

  // Navigation and home
  'Home': 'الرئيسية',
  'Dashboard': 'لوحة التحكم',
  'Management': 'الإدارة',
  'Oversight': 'المتابعة',
  'Registration': 'التسجيل',
  'Financial': 'المالية',
  'Account': 'الحساب',
  'Register Subjects': 'تسجيل المواد',
  'My Registrations': 'تسجيلاتي',
  'History': 'السجل',
  'Approvals': 'الموافقات',
  'Escrow Balance': 'رصيد الحساب',
  'Checkout': 'الدفع',
  'Linked Children': 'الأبناء المرتبطون',
  'Linked Parents': 'أولياء الأمور المرتبطون',
  'Notifications': 'الإشعارات',
  'Profile': 'الملف الشخصي',
  'My Requests': 'طلباتي',
  'Browse Subjects': 'تصفح المواد',
  'Pending Requests': 'الطلبات المعلقة',
  'Sessions': 'الجلسات',
  'Payments': 'المدفوعات',
  'Escrow': 'الرصيد',
  'Reports': 'التقارير',
  'Audit Log': 'سجل التدقيق',
  'Sign Out': 'تسجيل الخروج',
  'IGCSE Subject Reservation System': 'نظام حجز مواد IGCSE',
  'Register subjects for your children': 'سجّل المواد لأبنائك',
  'Browse and register for exam subjects': 'تصفح وسجّل مواد الامتحان',
  'View current registrations and status': 'اعرض التسجيلات الحالية وحالاتها',
  'View all available IGCSE subjects and pricing': 'اعرض كل مواد IGCSE المتاحة وأسعارها',
  'View pending drop and swap requests': 'اعرض طلبات الحذف والتبديل المعلقة',
  'Manage parent-student connections': 'إدارة روابط ولي الأمر والطالب',
  'View and update your account information': 'عرض وتحديث معلومات حسابك',
  'View balance and request withdrawals': 'عرض الرصيد وطلب السحب',
  'Review and approve student requests': 'مراجعة طلبات الطلاب والموافقة عليها',
  'Your student record shows you have graduated. Registration, drop, and swap features are no longer available.': 'يشير سجل الطالب إلى أنك تخرجت. لم تعد ميزات التسجيل والحذف والتبديل متاحة.',
  'If you believe this is an error, please contact the school administration.': 'إذا كنت تعتقد أن هذا خطأ، يرجى التواصل مع إدارة المدرسة.',

  // Dashboard and reports
  'Admin Dashboard': 'لوحة تحكم الإدارة',
  'Action Required': 'إجراءات مطلوبة',
  'Pending Approvals': 'الموافقات المعلقة',
  'Registration requests': 'طلبات التسجيل',
  'Pending Payments': 'مدفوعات معلقة',
  'Awaiting parent payment': 'بانتظار دفع ولي الأمر',
  'Change Requests': 'طلبات التغيير',
  'Drop / swap requests': 'طلبات حذف / تبديل',
  'Bank Transfers': 'التحويلات البنكية',
  'Manual confirmation needed': 'تحتاج تأكيد يدوي',
  'Withdrawals': 'السحوبات',
  'Current Session': 'الجلسة الحالية',
  'Current Sessions': 'الجلسات الحالية',
  'Active Sessions': 'الجلسات النشطة',
  'Registrations (Current)': 'التسجيلات الحالية',
  'Revenue (Current)': 'الإيراد الحالي',
  'Confirmed payments': 'مدفوعات مؤكدة',
  'Confirmed This Month': 'المؤكد هذا الشهر',
  'Overview': 'نظرة عامة',
  'Escrow Liability': 'التزامات الأرصدة',
  'Total Parents': 'إجمالي أولياء الأمور',
  'Students by Grade': 'الطلاب حسب الصف',
  'Full report': 'التقرير الكامل',
  'Results': 'النتائج',
  'Run Report': 'تشغيل التقرير',
  'Generating report...': 'جار إنشاء التقرير...',
  'Registration Report': 'تقرير التسجيل',
  'Financial Summary': 'الملخص المالي',
  'Subject Enrollment': 'الالتحاق بالمواد',
  'Grade 10 Compliance': 'التزام الصف العاشر',
  'Student Roster': 'قائمة الطلاب',
  'Escrow Report': 'تقرير الرصيد',
  'Comprehensive Staff Analytics': 'تحليلات شاملة للموظفين',
  'Registration Requests': 'طلبات التسجيل',
  'Drop / Swap Requests': 'طلبات الحذف / التبديل',
  'Core subjects': 'المواد الأساسية',
  'Per-subject status': 'حالة كل مادة',
  'Select a session...': 'اختر جلسة...',
  'All grades': 'كل الصفوف',
  'Grade 10': 'الصف 10',
  'Grade 11': 'الصف 11',
  'Grade 12': 'الصف 12',
  'Graduated': 'متخرج',
  'Summary': 'الملخص',
  'Section': 'القسم',

  // Registration and subjects
  'Available Subjects': 'المواد المتاحة',
  'Select Subjects': 'اختر المواد',
  'Selected Subjects': 'المواد المختارة',
  'My Subjects': 'موادي',
  'Core Subjects': 'المواد الأساسية',
  'School Subjects': 'مواد المدرسة',
  'Non-School Subjects': 'مواد خارج المدرسة',
  'All councils': 'كل المجالس',
  'Council': 'المجلس',
  'Code': 'الكود',
  'Register': 'تسجيل',
  'Register More': 'تسجيل المزيد',
  'Pay Now': 'ادفع الآن',
  'Proceed to Payment': 'المتابعة للدفع',
  'Back to Registrations': 'العودة للتسجيلات',
  'Full History': 'السجل الكامل',
  'Drop Subject': 'حذف المادة',
  'Swap Subject': 'تبديل المادة',
  'Current Subject': 'المادة الحالية',
  'New Subject': 'المادة الجديدة',
  'Request Drop': 'طلب حذف',
  'Request Swap': 'طلب تبديل',
  'No subjects available': 'لا توجد مواد متاحة',
  'No registrations found.': 'لا توجد تسجيلات.',
  'Register for subjects': 'التسجيل في المواد',
  'Registration History': 'سجل التسجيل',
  'Full audit trail across all sessions.': 'مسار تدقيق كامل عبر كل الجلسات.',
  'Select a child': 'اختر ابنًا/ابنة',
  'Select a child above to view their registration history.': 'اختر ابنًا/ابنة أعلاه لعرض سجل التسجيل.',
  'Confirmed:': 'مؤكد:',
  'Dropped:': 'محذوف:',
  'Additional payment': 'دفعة إضافية',
  'escrow credit': 'رصيد مضاف',
  'additional payment': 'دفعة إضافية',
  'Subjects registered successfully! Proceed to payment to confirm.': 'تم تسجيل المواد بنجاح! تابع إلى الدفع للتأكيد.',
  'Step 1': 'الخطوة 1',
  'Step 2': 'الخطوة 2',
  'Step 3': 'الخطوة 3',
  'Choose Student': 'اختر الطالب',
  'Choose Session': 'اختر الجلسة',
  'Select a student': 'اختر طالبًا',
  'No active sessions': 'لا توجد جلسات نشطة',
  'No subjects match your filters.': 'لا توجد مواد تطابق عوامل التصفية.',
  'Clear filters': 'مسح عوامل التصفية',
  'Total Cost': 'إجمالي التكلفة',

  // Profile and links
  'My Profile': 'ملفي الشخصي',
  'Edit Profile': 'تعديل الملف الشخصي',
  'Back to Dashboard': 'العودة للوحة التحكم',
  'Back to Profile': 'العودة للملف الشخصي',
  'Sign out of your account': 'تسجيل الخروج من حسابك',
  'View and manage parent connections': 'عرض وإدارة روابط أولياء الأمور',
  'Link a Child': 'ربط ابن/ابنة',
  "Request to link your child's student account": 'اطلب ربط حساب الطالب الخاص بابنك/ابنتك',
  'Student Email or Student ID': 'بريد الطالب أو رقم الطالب',
  'Your child will need to approve this request': 'سيحتاج الطالب إلى الموافقة على هذا الطلب',
  'Send Request': 'إرسال الطلب',
  'Sending...': 'جار الإرسال...',
  '+ Add Child': '+ إضافة ابن/ابنة',
  'Your Children': 'أبناؤك',
  'Your Parents': 'أولياء أمرك',
  'Awaiting approval': 'بانتظار الموافقة',
  'Linked': 'مرتبط',
  'About Parent Links': 'حول روابط أولياء الأمور',
  'No children linked yet. Send a link request to get started.': 'لا يوجد أبناء مرتبطون بعد. أرسل طلب ربط للبدء.',
  'No parents linked to your account.': 'لا يوجد أولياء أمور مرتبطون بحسابك.',
  'Failed to load data': 'تعذر تحميل البيانات',
  'Failed to create link request': 'تعذر إنشاء طلب الربط',
  'Link request sent successfully!': 'تم إرسال طلب الربط بنجاح!',
  'Link request approved!': 'تمت الموافقة على طلب الربط!',
  'Link request rejected!': 'تم رفض طلب الربط!',
  'When a parent is linked to your account, they can register subjects on': 'عند ربط ولي أمر بحسابك، يمكنه تسجيل المواد',
  'balance. You can approve or reject link requests at any time.': 'والاطلاع على الرصيد. يمكنك الموافقة على طلبات الربط أو رفضها في أي وقت.',

  // Escrow and checkout
  'My Escrow Balance': 'رصيد حسابي',
  'Escrow Management': 'إدارة الرصيد',
  'Transfer Funds': 'تحويل أموال',
  'Request Withdrawal': 'طلب سحب',
  'Transfer Escrow Funds': 'تحويل رصيد الحساب',
  'Back to Escrow': 'العودة للرصيد',
  'Current Escrow Balance': 'رصيد الحساب الحالي',
  'Apply Escrow Balance': 'استخدام رصيد الحساب',
  'Escrow applied': 'تم استخدام الرصيد',
  'Open Wallet': 'فتح المحفظة',
  'Payment Method': 'طريقة الدفع',
  'Payment Summary': 'ملخص الدفع',
  'Fully Escrow-Funded': 'ممولة بالكامل من الرصيد',
  'Payment completed': 'تم الدفع',
  'Payment failed': 'فشل الدفع',
  'Amount to Pay': 'المبلغ المطلوب دفعه',
  'Escrow Available': 'الرصيد المتاح',
  'Apply escrow': 'استخدام الرصيد',
  'Card': 'بطاقة',
  'Mobile Wallet': 'محفظة إلكترونية',
  'Bank Transfer': 'تحويل بنكي',
  'Fawry': 'فوري',
  'Create Payment': 'إنشاء دفعة',
  'Creating payment...': 'جار إنشاء الدفعة...',

  // Admin pages
  'Manage Subjects': 'إدارة المواد',
  'Create Subject': 'إنشاء مادة',
  'Edit Subject': 'تعديل مادة',
  'Create Session': 'إنشاء جلسة',
  'Edit Session': 'تعديل جلسة',
  'Activate': 'تفعيل',
  'Close Session': 'إغلاق الجلسة',
  'Admin Payments': 'مدفوعات الإدارة',
  'Confirm Payment': 'تأكيد الدفع',
  'Admin Escrow': 'أرصدة الإدارة',
  'Bulk Announcement': 'إعلان جماعي',
  'Send Announcement': 'إرسال إعلان',
  'Schedule Announcement': 'جدولة إعلان',
  'Audit Trail': 'مسار التدقيق',
  'Entity Type': 'نوع الكيان',
  'Action': 'الإجراء',
  'User': 'المستخدم',
  'Timestamp': 'الوقت',
  'Pending Bank Transfers': 'تحويلات بنكية معلقة',
  'Pending bank transfers': 'تحويلات بنكية معلقة',
  'Subject Management': 'إدارة المواد',
  'Session Management': 'إدارة الجلسات',
  'Price In School': 'سعر المدرسة',
  'Custom Price': 'سعر مخصص',
  'Offered at School': 'متاحة في المدرسة',
  'Core Subject': 'مادة أساسية',
  'Active only': 'النشطة فقط',
  'Announcement Title': 'عنوان الإعلان',
  'Announcement Body': 'نص الإعلان',
  'Recipients': 'المستلمون',
  'Send Email': 'إرسال بريد إلكتروني',
  'Send Now': 'إرسال الآن',
  'Scheduled': 'مجدول',

  // Notifications/documents
  'Mark all as read': 'تمييز الكل كمقروء',
  'Unread': 'غير مقروء',
  'Read': 'مقروء',
  'Documents': 'المستندات',
  'Upload': 'رفع',
  'Download': 'تنزيل',
  'Drop & Swap Requests': 'طلبات الحذف والتبديل',
  'Approve Change Request': 'الموافقة على طلب التغيير',
  'Reject Change Request': 'رفض طلب التغيير',
  'Confirm Approval': 'تأكيد الموافقة',
  'Confirm Rejection': 'تأكيد الرفض',
  'Approving...': 'جار الموافقة...',
  'Rejecting...': 'جار الرفض...',
  'This action is permanent. Rejected registrations cannot be un-rejected.': 'هذا الإجراء دائم. لا يمكن إلغاء رفض التسجيلات.',
  'Explain to your child why this request is being rejected...': 'اشرح لابنك/ابنتك سبب رفض هذا الطلب...',
  'Add a note to your child...': 'أضف ملاحظة لابنك/ابنتك...',
  'Optional note to your child...': 'ملاحظة اختيارية لابنك/ابنتك...',
  "Explain why you're rejecting this request...": 'اشرح سبب رفض هذا الطلب...',
  'No financial impact.': 'لا يوجد أثر مالي.',
  'Current Price': 'السعر الحالي',
  'New Price': 'السعر الجديد',
  'Impact': 'الأثر',
  'Swap to:': 'تبديل إلى:',

  // Full UI sweep
  'Unauthorized': 'غير مصرح',
  'You do not have access to this page.': 'ليس لديك صلاحية للوصول إلى هذه الصفحة.',
  'Invalid reset link': 'رابط إعادة التعيين غير صالح',
  'This password reset link is invalid or has expired.': 'رابط إعادة تعيين كلمة المرور غير صالح أو انتهت صلاحيته.',
  'Password reset successful': 'تمت إعادة تعيين كلمة المرور بنجاح',
  'Your password has been updated. You can now sign in with your new password.': 'تم تحديث كلمة المرور. يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.',
  'Set new password': 'تعيين كلمة مرور جديدة',
  'Choose a strong password for your account. It must be at least 8 characters with one uppercase letter and one number.': 'اختر كلمة مرور قوية لحسابك. يجب أن تكون 8 أحرف على الأقل وتحتوي على حرف كبير ورقم.',
  'New password': 'كلمة المرور الجديدة',
  'Create a strong password': 'أنشئ كلمة مرور قوية',
  'Min 8 characters, 1 uppercase, 1 number': '8 أحرف على الأقل، حرف كبير واحد، ورقم واحد',
  'Confirm your new password': 'أكّد كلمة المرور الجديدة',
  'Password must contain at least one uppercase letter': 'يجب أن تحتوي كلمة المرور على حرف كبير واحد على الأقل',
  'Password must contain at least one number': 'يجب أن تحتوي كلمة المرور على رقم واحد على الأقل',
  'Failed to reset password. The link may have expired.': 'تعذر إعادة تعيين كلمة المرور. ربما انتهت صلاحية الرابط.',
  'Missing verification token': 'رمز التحقق مفقود',
  'This link appears to be incomplete. Please check your email and click the full verification link.': 'يبدو أن هذا الرابط غير مكتمل. تحقق من بريدك الإلكتروني واضغط على رابط التحقق الكامل.',
  'Verifying your email': 'جار التحقق من بريدك الإلكتروني',
  'Please wait while we verify your email address.': 'يرجى الانتظار بينما نتحقق من بريدك الإلكتروني.',
  'This should only take a moment...': 'سيستغرق ذلك لحظة فقط...',
  'Email verified': 'تم التحقق من البريد الإلكتروني',
  'Your email address has been successfully verified. You can now sign in to your account.': 'تم التحقق من بريدك الإلكتروني بنجاح. يمكنك الآن تسجيل الدخول إلى حسابك.',
  'Verification failed': 'فشل التحقق',
  'Student Registration': 'تسجيل طالب',
  'Create your IGCSE student account to start reserving subjects.': 'أنشئ حساب طالب IGCSE لبدء حجز المواد.',
  'Create your parent account to manage your children': 'أنشئ حساب ولي أمر لإدارة أبنائك',
  'Browse and reserve subjects': 'تصفح واحجز المواد',
  'Track registration status': 'تابع حالة التسجيل',
  'Choose your account type to get started with IGCSE subject reservations.': 'اختر نوع الحساب للبدء في حجز مواد IGCSE.',
  'Quick Setup': 'إعداد سريع',
  '2 min': 'دقيقتان',
  'Data Protected': 'البيانات محمية',
  'Secure': 'آمن',
  'Free': 'مجاني',
  'To Register': 'للتسجيل',
  'Total subjects': 'إجمالي المواد',
  'Core (Grade 10)': 'مواد أساسية (الصف 10)',
  'Examination Council': 'مجلس الامتحانات',
  'Registration Price': 'سعر التسجيل',
  'No subjects match your search.': 'لا توجد مواد تطابق البحث.',
  'No subjects are available at this time.': 'لا توجد مواد متاحة حاليًا.',
  'Select a child, then choose a session and subjects to register directly.': 'اختر ابنًا/ابنة، ثم اختر جلسة ومواد للتسجيل مباشرة.',
  'Select subjects to register. Your request will be sent to your parent for approval.': 'اختر المواد للتسجيل. سيتم إرسال طلبك إلى ولي الأمر للموافقة.',
  'Select Registration Window': 'اختر نافذة التسجيل',
  'No subjects are available for registration in this session. This may be because all subjects have already been registered, or no subjects are currently active.': 'لا توجد مواد متاحة للتسجيل في هذه الجلسة. قد يكون السبب أن كل المواد سُجلت بالفعل أو لا توجد مواد نشطة حاليًا.',
  'No subjects match the selected filter.': 'لا توجد مواد تطابق عامل التصفية المحدد.',
  'Submitting...': 'جار الإرسال...',
  'No Registrations Yet': 'لا توجد تسجيلات بعد',
  'You have not registered for any subjects yet.': 'لم تسجل أي مواد بعد.',
  '+ Register More': '+ تسجيل المزيد',
  'All Children': 'كل الأبناء',
  'No registrations match the selected filter.': 'لا توجد تسجيلات تطابق عامل التصفية المحدد.',
  'Confirm Drop': 'تأكيد الحذف',
  'Dropping...': 'جار الحذف...',
  'Confirm Swap': 'تأكيد التبديل',
  'Swapping...': 'جار التبديل...',
  'Direct Swap': 'تبديل مباشر',
  'Select a subject': 'اختر مادة',
  'Select a subject to swap to': 'اختر المادة البديلة',
  'Same price — no financial impact': 'نفس السعر - لا يوجد أثر مالي',
  'Same price — full escrow credit then payment of same amount required.': 'نفس السعر - سيتم إضافة رصيد كامل ثم يلزم دفع نفس المبلغ.',
  'Original price': 'السعر الأصلي',
  'New subject price': 'سعر المادة الجديدة',
  'Financial impact': 'الأثر المالي',
  'No change requests submitted yet.': 'لم يتم إرسال طلبات تغيير بعد.',
  'My Pending Requests': 'طلباتي المعلقة',
  'Confirm Bank Transfer': 'تأكيد التحويل البنكي',
  'Yes, Confirm': 'نعم، تأكيد',
  'Confirming...': 'جار التأكيد...',
  'Payment confirmed successfully. Registrations moved to Confirmed.': 'تم تأكيد الدفع بنجاح. تم نقل التسجيلات إلى مؤكدة.',
  'No pending bank transfers': 'لا توجد تحويلات بنكية معلقة',
  'All transfers have been confirmed.': 'تم تأكيد كل التحويلات.',
  'Bank Reference': 'مرجع البنك',
  'e.g., Verified via bank statement ref #12345678': 'مثال: تم التحقق عبر كشف البنك مرجع #12345678',
  'Bank Transfer Confirmations': 'تأكيدات التحويل البنكي',
  'File Management': 'إدارة الملفات',
  'Upload and manage your files': 'ارفع وأدر ملفاتك',
  'Upload File': 'رفع ملف',
  'All Files': 'كل الملفات',
  'Avatars': 'الصور الشخصية',
  'General': 'عام',
  'Avatar (Images, max 5MB)': 'صورة شخصية (صور، بحد أقصى 5 ميجابايت)',
  'Document (PDF, DOCX, XLSX, max 10MB)': 'مستند (PDF أو DOCX أو XLSX، بحد أقصى 10 ميجابايت)',
  'General File (max 50MB)': 'ملف عام (بحد أقصى 50 ميجابايت)',
  'File uploaded successfully!': 'تم رفع الملف بنجاح!',
  'Failed to upload file. Please try again.': 'تعذر رفع الملف. حاول مرة أخرى.',
  'Failed to delete file. Please try again.': 'تعذر حذف الملف. حاول مرة أخرى.',
  'Avatar must be an image': 'يجب أن تكون الصورة الشخصية ملف صورة',
  'Avatar must be 5MB or less': 'يجب ألا تتجاوز الصورة الشخصية 5 ميجابايت',
  'Document must be 10MB or less': 'يجب ألا يتجاوز المستند 10 ميجابايت',
  'File must be 50MB or less': 'يجب ألا يتجاوز الملف 50 ميجابايت',
  'Preview': 'معاينة',
  'Upload Avatar': 'رفع صورة شخصية',
  'Change Image': 'تغيير الصورة',
  'Uploading...': 'جار الرفع...',
  'Current Avatar': 'الصورة الحالية',
  'Current avatar': 'الصورة الحالية',
  'Uploading and generating thumbnails...': 'جار الرفع وإنشاء الصور المصغرة...',
  'Please select an image file': 'يرجى اختيار ملف صورة',
  'Image must be 5MB or less': 'يجب ألا تتجاوز الصورة 5 ميجابايت',
  'Failed to upload avatar. Please try again.': 'تعذر رفع الصورة الشخصية. حاول مرة أخرى.',
  'Notifications will appear here when there is activity on your account.': 'ستظهر الإشعارات هنا عند حدوث نشاط على حسابك.',
  'No notifications yet': 'لا توجد إشعارات بعد',
  'No unread notifications': 'لا توجد إشعارات غير مقروءة',
  'Unread only': 'غير المقروءة فقط',
  'Load more': 'تحميل المزيد',
  'Announcement title...': 'عنوان الإعلان...',
  'Write your announcement here...': 'اكتب الإعلان هنا...',
  'Show preview': 'إظهار المعاينة',
  'Hide preview': 'إخفاء المعاينة',
  'Schedule announcement': 'جدولة الإعلان',
  'Send announcement': 'إرسال الإعلان',
  'Scheduling...': 'جار الجدولة...',
  'Created by': 'أنشأه',
  'Title': 'العنوان',
  'Cancel this scheduled announcement? It will not be sent.': 'هل تريد إلغاء هذا الإعلان المجدول؟ لن يتم إرساله.',
  'the selected time': 'الوقت المحدد',
  'New Registration Session': 'جلسة تسجيل جديدة',
  'Extend Deadline': 'تمديد الموعد النهائي',
  'Explain why the deadline is being extended...': 'اشرح سبب تمديد الموعد النهائي...',
  'No sessions found.': 'لا توجد جلسات.',
  'Creating...': 'جار الإنشاء...',
  'Save Changes': 'حفظ التغييرات',
  'Start Date': 'تاريخ البدء',
  'End Date': 'تاريخ الانتهاء',
  'If start date is now or in the past, the session will open immediately as': 'إذا كان تاريخ البدء الآن أو في الماضي، فستفتح الجلسة فورًا كـ',
  '. Otherwise it starts as': '. وإلا فستبدأ كـ',
  'and is activated when the start date arrives.': 'ويتم تفعيلها عند حلول تاريخ البدء.',
  'Status:': 'الحالة:',
  'Type:': 'النوع:',
  'From:': 'من:',
  'To:': 'إلى:',
  'All Statuses': 'كل الحالات',
  'All Councils': 'كل المجالس',
  'Search by name or code...': 'ابحث بالاسم أو الكود...',
  'No subjects found.': 'لا توجد مواد.',
  'Deactivate': 'إلغاء التفعيل',
  'Inactive': 'غير نشطة',
  'Remove core designation': 'إزالة تصنيف المادة الأساسية',
  'Mark as core': 'تعيين كمادة أساسية',
  'Offered at school': 'متاحة في المدرسة',
  'Custom Price (External)': 'سعر مخصص (خارجي)',
  'Applies when the school does not teach this subject.': 'ينطبق عندما لا تُدرّس المدرسة هذه المادة.',
  'e.g. Mathematics': 'مثال: Mathematics',
  'e.g. MATH-4MB1': 'مثال: MATH-4MB1',
  'e.g. June 2026': 'مثال: يونيو 2026',
  'All actions': 'كل الإجراءات',
  'Entity type': 'نوع الكيان',
  'All types': 'كل الأنواع',
  'From': 'من',
  'To': 'إلى',
  'Loading history...': 'جار تحميل السجل...',
  'Failed to load entity history.': 'تعذر تحميل سجل الكيان.',
  'No history found for this entity.': 'لا يوجد سجل لهذا الكيان.',
  'System': 'النظام',
  'Loading audit logs...': 'جار تحميل سجلات التدقيق...',
  'Failed to load audit logs.': 'تعذر تحميل سجلات التدقيق.',
  'No audit log entries match the current filters.': 'لا توجد إدخالات سجل تدقيق تطابق عوامل التصفية الحالية.',
  'Time': 'الوقت',
  'Entity': 'الكيان',
  'Entity ID': 'معرف الكيان',
  'Performed by': 'نفذه',
  'Diff': 'الفروقات',
  'Before': 'قبل',
  'After': 'بعد',
  'Payment Complete': 'اكتمل الدفع',
  'Payment Initiated': 'بدأ الدفع',
  'Your payment is pending. Follow the instructions below to complete it.': 'دفعتك معلقة. اتبع التعليمات أدناه لإكمالها.',
  'Fawry Reference Code': 'كود مرجع فوري',
  'Complete your card payment': 'أكمل الدفع بالبطاقة',
  'Opens secure payment page in a new tab': 'يفتح صفحة دفع آمنة في تبويب جديد',
  'Bank Transfer Details': 'تفاصيل التحويل البنكي',
  'Payment Reference (required)': 'مرجع الدفع (مطلوب)',
  'Amount due': 'المبلغ المستحق',
  'Registration Summary': 'ملخص التسجيل',
  'Remaining to pay via payment method:': 'المتبقي للدفع عبر طريقة الدفع:',
  'Unable to load checkout details.': 'تعذر تحميل تفاصيل الدفع.',
  '24h from now': 'بعد 24 ساعة من الآن',
  'Available Balance': 'الرصيد المتاح',
  'Transaction History': 'سجل المعاملات',
  'Subject Drop Refund': 'استرداد حذف مادة',
  'Swap Refund': 'استرداد التبديل',
  'Transfer Received': 'تحويل وارد',
  'Transfer Sent': 'تحويل صادر',
  'Cash Withdrawal': 'سحب نقدي',
  'Payment Applied': 'تم استخدام الدفع',
  'Payment Refund': 'استرداد دفع',
  'Transfer Found After Closing': 'تحويل وُجد بعد الإغلاق',
  'Transfer Recorded by Mistake — Removed': 'تحويل سُجّل بالخطأ — أُزيل',
  'Cash Refund Requested': 'طلب استرداد نقدي',
  'Refund Request Declined — Returned': 'رُفض طلب الاسترداد — أُعيد المبلغ',
  'Held for a Preregistered Subject': 'محجوز لمادة مسجلة مسبقًا',
  'Held Money Applied to Subject': 'استُخدم المبلغ المحجوز للمادة',
  'Preregistration Cancelled — Hold Released': 'أُلغي التسجيل المسبق — حُرّر المبلغ المحجوز',
  'Transfer Complete': 'اكتمل التحويل',
  'Amount (EGP)': 'المبلغ (جنيه)',
  'Amount exceeds available balance': 'المبلغ يتجاوز الرصيد المتاح',
  'At least two linked children are required to transfer funds.': 'يلزم وجود طفلين مرتبطين على الأقل لتحويل الأموال.',
  'Select child': 'اختر ابنًا/ابنة',
  'Child': 'الابن/الابنة',
  'Transferring...': 'جار التحويل...',
  'Request Submitted': 'تم إرسال الطلب',
  'Withdrawal History': 'سجل السحوبات',
  'Submit Withdrawal Request': 'إرسال طلب السحب',
  'Withdrawal Requests': 'طلبات السحب',
  'Total Requested': 'إجمالي المطلوب',
  'Already Released': 'تم الصرف بالفعل',
  'Remaining': 'المتبقي',
  'Fulfill Withdrawal': 'تنفيذ السحب',
  'Confirm Release': 'تأكيد الصرف',
  'Processing...': 'جار المعالجة...',
  'Reject Withdrawal Request': 'رفض طلب السحب',
  'Reject Request': 'رفض الطلب',
  'Explain why this request is being rejected...': 'اشرح سبب رفض هذا الطلب...',
  'Bank reference number, notes...': 'رقم مرجع البنك، ملاحظات...',
  'Requested': 'مطلوب',
  'Released': 'مصروف',
  '(optional)': '(اختياري)',
  'Select all': 'تحديد الكل',
  'Deselect all': 'إلغاء تحديد الكل',
  '(External)': '(خارجي)',
  'Phone Number': 'رقم الهاتف',
  'Pending Withdrawals': 'سحوبات معلقة',
  'No active registration window': 'لا توجد نافذة تسجيل نشطة',
  "You'll be notified by email when the next window opens.": 'سيتم إشعارك عبر البريد الإلكتروني عند فتح النافذة التالية.',
  'Payment Reference': 'مرجع الدفع',
  'Pending Revenue (EGP)': 'الإيراد المعلق (جنيه)',
  'Total Confirmed Revenue (EGP)': 'إجمالي الإيراد المؤكد (جنيه)',
  'Confirmed Revenue -- School Subjects (EGP)': 'الإيراد المؤكد - مواد المدرسة (جنيه)',
  'Confirmed Revenue -- Non-School Subjects (EGP)': 'الإيراد المؤكد - مواد خارج المدرسة (جنيه)',
  'Patterns Demonstrated': 'أنماط معروضة',
  '✓ Server-side rendering with data pre-fetching': '✓ عرض من الخادم مع جلب البيانات مسبقًا',
  '✓ Type-safe API calls with Hono RPC': '✓ استدعاءات API آمنة الأنواع باستخدام Hono RPC',
  '✓ Optimistic UI updates for instant feedback': '✓ تحديثات فورية للواجهة قبل تأكيد الخادم',
  '✓ Automatic error handling and rollback': '✓ معالجة أخطاء تلقائية وتراجع عند الفشل',
  '✓ Form validation with controlled components': '✓ تحقق من النماذج بمكونات مضبوطة',
  '✓ CRUD operations (Create, Read, Update, Delete)': '✓ عمليات الإنشاء والقراءة والتحديث والحذف',
  '✓ Type-safe file uploads with Hono RPC (no manual types!)': '✓ رفع ملفات آمن الأنواع باستخدام Hono RPC بدون تعريفات يدوية',
  '✓ FormData handling for multipart uploads': '✓ التعامل مع FormData لرفع الملفات متعددة الأجزاء',
  '✓ Image variant display (thumbnail, medium, large)': '✓ عرض نسخ الصور: مصغرة ومتوسطة وكبيرة',
  '✓ Pagination with query params': '✓ ترقيم الصفحات باستخدام معاملات الرابط',
  '✓ Filtering by file type': '✓ تصفية حسب نوع الملف',
  '✓ Optimistic UI updates with automatic rollback': '✓ تحديثات فورية للواجهة مع تراجع تلقائي',
  '✓ File deletion with confirmation': '✓ حذف الملفات مع التأكيد',
  'EGP': 'جنيه',
  'IP:': 'عنوان IP:',
  'Explain why you': 'اشرح سبب',
  'Explain why you want to drop this subject...': 'اشرح سبب رغبتك في حذف هذه المادة...',
  'Explain why you want to swap this subject...': 'اشرح سبب رغبتك في تبديل هذه المادة...',
  'approvals link': 'رابط الموافقات',
  'student@example.com or STU-20260128-XXXXX': 'student@example.com أو STU-20260128-XXXXX',
  'Secure your': 'أمّن',
  'account.': 'حسابك.',
  'Request a new reset link': 'طلب رابط إعادة تعيين جديد',
  'Sign in to your account': 'تسجيل الدخول إلى حسابك',
  'Create a strong, unique password that you do not use elsewhere. Your account security is our priority.': 'أنشئ كلمة مرور قوية وفريدة لا تستخدمها في مكان آخر. أمان حسابك هو أولويتنا.',
  'A new verification email has been sent to': 'تم إرسال بريد تحقق جديد إلى',
  '. Please check your inbox.': '. يرجى التحقق من صندوق الوارد.',
  'Enter your email to receive a new verification link:': 'أدخل بريدك الإلكتروني لاستلام رابط تحقق جديد:',
  'Failed to resend verification email. Please try again.': 'تعذر إعادة إرسال بريد التحقق. حاول مرة أخرى.',
  'Verification failed. The link may have expired or already been used.': 'فشل التحقق. ربما انتهت صلاحية الرابط أو تم استخدامه بالفعل.',
  'Your email has been confirmed. You are all set to start using IGCSE Reserve.': 'تم تأكيد بريدك الإلكتروني. يمكنك الآن استخدام حجز IGCSE.',
  'Setting up...': 'جار الإعداد...',
  'Your account is set up as a': 'تم إعداد حسابك كـ',
  'Setup Failed': 'فشل الإعداد',
  'Please wait while we complete your student profile.': 'يرجى الانتظار بينما نكمل ملف الطالب.',
  'Failed to complete profile setup': 'تعذر إكمال إعداد الملف الشخصي',
  'Support your': 'ادعم',
  'child&apos;s success.': 'نجاح ابنك/ابنتك.',
  "child's success.": 'نجاح ابنك/ابنتك.',
  'academic future.': 'مستقبلك الأكاديمي.',
  'Shape your': 'شكّل',
  'After registration': 'بعد التسجيل',
  'Creating account...': 'جار إنشاء الحساب...',
  'Choose the IGCSE subjects that align with your goals. Track every step from registration to exam day.': 'اختر مواد IGCSE التي تناسب أهدافك. تابع كل خطوة من التسجيل حتى يوم الامتحان.',
  'Stay involved in every step. Manage registrations, handle payments, and keep track of your child&apos;s academic journey.': 'ابقَ مشاركًا في كل خطوة. أدر التسجيلات والمدفوعات وتابع الرحلة الأكاديمية لابنك/ابنتك.',
  "Stay involved in every step. Manage registrations, handle payments, and keep track of your child's academic journey.": 'ابقَ مشاركًا في كل خطوة. أدر التسجيلات والمدفوعات وتابع الرحلة الأكاديمية لابنك/ابنتك.',
  'Whether you are a student or a parent, we have got you covered with a seamless registration experience.': 'سواء كنت طالبًا أو ولي أمر، ستجد تجربة تسجيل سلسة ومناسبة لك.',
  'Register for IGCSE subjects, manage your registrations, and track your escrow balance.': 'سجّل مواد IGCSE، وأدر تسجيلاتك، وتابع رصيد حسابك.',
  'community.': 'المجتمع.',
  'Your academic': 'رحلتك الأكاديمية',
  'future starts here.': 'تبدأ هنا.',
  'Registration window has closed': 'أُغلقت نافذة التسجيل',
  'Registration open —': 'التسجيل مفتوح -',
  'session · closes': 'جلسة - تغلق',
  'Closing in': 'تغلق خلال',
  'There are no active registration windows at this time. Check back later or contact the school for more information.': 'لا توجد نوافذ تسجيل نشطة حاليًا. تحقق لاحقًا أو تواصل مع المدرسة للمزيد من المعلومات.',
  'Registration closed': 'التسجيل مغلق',
  'Register more subjects': 'تسجيل مواد إضافية',
  'Step 1 — Select Child': 'الخطوة 1 - اختر الطالب',
  '— Select Registration Window': '- اختر نافذة التسجيل',
  '— Select Subjects': '- اختر المواد',
  '— Summary': '- الملخص',
  'to connect with a student.': 'للتواصل مع طالب.',
  'Core subjects (Grade 10 June) are pre-selected and mandatory.': 'المواد الأساسية للصف 10 في يونيو محددة مسبقًا وإلزامية.',
  'Registration request submitted! Awaiting parent approval.': 'تم إرسال طلب التسجيل! بانتظار موافقة ولي الأمر.',
  'Your request will be sent to your linked parent for approval. Payment is required after approval.': 'سيتم إرسال طلبك إلى ولي الأمر المرتبط للموافقة. الدفع مطلوب بعد الموافقة.',
  'Browse all IGCSE subjects available for registration': 'تصفح كل مواد IGCSE المتاحة للتسجيل',
  'Core only': 'المواد الأساسية فقط',
  'Students taking school subjects with external teachers pay the full school price.': 'الطلاب الذين يدرسون مواد المدرسة مع مدرسين خارجيين يدفعون سعر المدرسة كاملًا.',
  'This subject is not taught at school. Students register as external candidates.': 'هذه المادة لا تُدرّس في المدرسة. يسجّل الطلاب كمرشحين خارجيين.',
  'Children&apos;s Registrations': 'تسجيلات الأبناء',
  "Children's Registrations": 'تسجيلات الأبناء',
  'Approved by parent — awaiting payment.': 'تمت الموافقة من ولي الأمر - بانتظار الدفع.',
  'A drop/swap request for this registration is already pending approval. Cancel it from the pending requests page before submitting a new one.': 'يوجد بالفعل طلب حذف/تبديل لهذا التسجيل بانتظار الموافقة. ألغِه من صفحة الطلبات المعلقة قبل إرسال طلب جديد.',
  'Core subjects cannot be dropped or swapped (Grade 10 June requirement).': 'لا يمكن حذف أو تبديل المواد الأساسية (متطلب الصف 10 في يونيو).',
  'Registration window is closed. Drop/swap operations are unavailable.': 'نافذة التسجيل مغلقة. عمليات الحذف والتبديل غير متاحة.',
  'Drop:': 'حذف:',
  'will be credited to your escrow.': 'سيتم إضافته إلى رصيدك.',
  'Current price:': 'السعر الحالي:',
  'Swap from:': 'تبديل من:',
  'Swapping from:': 'جار التبديل من:',
  '· Current price:': '· السعر الحالي:',
  ') credited to escrow.': ') تم إضافته إلى الرصيد.',
  'You are about to drop': 'أنت على وشك حذف',
  'will be credited to the student&apos;s escrow immediately.': 'سيتم إضافته إلى رصيد الطالب فورًا.',
  "will be credited to the student's escrow immediately.": 'سيتم إضافته إلى رصيد الطالب فورًا.',
  'You have pending requests awaiting parent approval. Share the': 'لديك طلبات معلقة بانتظار موافقة ولي الأمر. شارك',
  'with your parent.': 'مع ولي الأمر.',
  'registration(s) awaiting payment': 'تسجيلات بانتظار الدفع',
  'Registration Sessions': 'جلسات التسجيل',
  '— Open': '- مفتوحة',
  'total': 'إجمالي',
  'Closes': 'تغلق',
  'Close Early': 'إغلاق مبكر',
  'Session Name': 'اسم الجلسة',
  'Session Type': 'نوع الجلسة',
  'Current deadline:': 'الموعد النهائي الحالي:',
  'This reason is recorded in the audit log.': 'سيتم تسجيل هذا السبب في سجل التدقيق.',
  'Please provide a reason (min 5 characters).': 'يرجى تقديم سبب (5 أحرف على الأقل).',
  'Both start and end dates are required.': 'تاريخا البدء والانتهاء مطلوبان.',
  'End date must be after start date.': 'يجب أن يكون تاريخ الانتهاء بعد تاريخ البدء.',
  'Edit History —': 'سجل التعديلات -',
  'deadline edit': 'تعديل الموعد النهائي',
  'changed': 'تم تغييره',
  'Reason:': 'السبب:',
  'Subject Name': 'اسم المادة',
  'Subject Code': 'كود المادة',
  'Price (In-School)': 'السعر داخل المدرسة',
  'External: EGP': 'خارجي: جنيه',
  'Please enter a valid price in school.': 'يرجى إدخال سعر صحيح داخل المدرسة.',
  'Custom price is required when subject is not offered at school.': 'السعر المخصص مطلوب عندما لا تكون المادة متاحة في المدرسة.',
  'All Caught Up': 'كل شيء مكتمل',
  'awaiting your decision': 'بانتظار قرارك',
  'request': 'طلب',
  'Approve Selected': 'الموافقة على المحدد',
  'Reject Selected': 'رفض المحدد',
  'selected ·': 'محدد ·',
  'approved — payment required to finalize.': 'تمت الموافقة - الدفع مطلوب للإكمال.',
  'approved successfully. Proceed to payment to finalize.': 'تمت الموافقة بنجاح. تابع إلى الدفع للإكمال.',
  'Registrations Approved': 'تمت الموافقة على التسجيلات',
  'A reason is required when rejecting a request.': 'السبب مطلوب عند رفض الطلب.',
  'Drop &amp; Swap Requests': 'طلبات الحذف والتبديل',
  'pending change request': 'طلب تغيير معلق',
  '— payment will be required to finalize these registrations.': '- سيكون الدفع مطلوبًا لإكمال هذه التسجيلات.',
  'Comment (optional)': 'تعليق (اختياري)',
  'Rejecting': 'جار رفض',
  'request for': 'طلب لـ',
  '. No financial impact.': '. لا يوجد أثر مالي.',
  'Confirm Transfer': 'تأكيد التحويل',
  'Review and confirm pending bank transfers to release registrations.': 'راجع وأكد التحويلات البنكية المعلقة لإطلاق التسجيلات.',
  'Download Receipt': 'تنزيل الإيصال',
  'Dismiss': 'إغلاق',
  'Confirm that you have received the bank transfer from': 'أكد أنك استلمت التحويل البنكي من',
  '. This will move': '. سيؤدي ذلك إلى نقل',
  'registration(s) to Confirmed.': 'تسجيلات إلى مؤكدة.',
  'Admin Notes (optional)': 'ملاحظات الإدارة (اختياري)',
  'Submitted:': 'تاريخ الإرسال:',
  'Waiting': 'بانتظار',
  'Subjects (': 'المواد (',
  'Bulk Announcements': 'الإعلانات الجماعية',
  'Send in-app notifications (and optionally email) to a group of users. (NOT-011)': 'أرسل إشعارات داخل التطبيق (وبريدًا اختياريًا) إلى مجموعة من المستخدمين. (NOT-011)',
  'Also send via email': 'إرسال عبر البريد الإلكتروني أيضًا',
  'Schedule for later': 'جدولة لوقت لاحق',
  'Send at': 'الإرسال في',
  'This time is in the past. The announcement will be sent immediately.': 'هذا الوقت في الماضي. سيتم إرسال الإعلان فورًا.',
  'Scheduled Announcements': 'الإعلانات المجدولة',
  'Auto-refreshes every 30 seconds. Pending announcements can be cancelled before their scheduled time.': 'يتم التحديث تلقائيًا كل 30 ثانية. يمكن إلغاء الإعلانات المعلقة قبل موعدها.',
  'Delivered to': 'تم الإرسال إلى',
  'recipients': 'مستلم',
  '· Scheduled:': '· مجدول:',
  '+ email': '+ بريد إلكتروني',
  'Failed to send announcement. Please try again.': 'تعذر إرسال الإعلان. حاول مرة أخرى.',
  'Chain of Custody': 'سلسلة المسؤولية',
  'Showing': 'عرض',
  'by': 'بواسطة',
  'Available:': 'المتاح:',
  'Amount to apply (EGP)': 'المبلغ المطلوب استخدامه (جنيه)',
  'Select Wallet Provider': 'اختر مزود المحفظة',
  'Bank transfer requires manual verification by an admin and may take 1-2 business days. You will receive bank details and a reference number after submitting.': 'يتطلب التحويل البنكي تحققًا يدويًا من الإدارة وقد يستغرق يومًا إلى يومي عمل. ستتلقى تفاصيل البنك ورقم المرجع بعد الإرسال.',
  'Bank Name': 'اسم البنك',
  'Account Name': 'اسم الحساب',
  'Account Number': 'رقم الحساب',
  'SWIFT Code': 'رمز SWIFT',
  'Branch': 'الفرع',
  'Complete payment for': 'إكمال الدفع لـ',
  '&apos;s subject registration': 'تسجيل مواد',
  "'s subject registration": 'تسجيل مواد',
  'escrow)': 'رصيد)',
  'A receipt has been emailed to you. Your subjects are confirmed.': 'تم إرسال إيصال إلى بريدك الإلكتروني. تم تأكيد موادك.',
  'Your registrations have been confirmed — no payment was required because escrow covered the full amount.': 'تم تأكيد تسجيلاتك - لم يكن الدفع مطلوبًا لأن الرصيد غطى المبلغ بالكامل.',
  'Verify the registrations belong to a linked child and are ready for payment.': 'تحقق من أن التسجيلات تخص ابنًا/ابنة مرتبطًا وأنها جاهزة للدفع.',
  'Ref:': 'المرجع:',
  'Amount to Release (EGP)': 'المبلغ المطلوب صرفه (جنيه)',
  'Previous note:': 'الملاحظة السابقة:',
  'Admin note:': 'ملاحظة الإدارة:',
  'Rejecting this request for': 'رفض هذا الطلب لـ',
  'EGP). No funds will be moved.': 'جنيه). لن يتم نقل أي أموال.',
  'Refresh': 'تحديث',
  'Submitted': 'تم الإرسال',
  'EGP available': 'جنيه متاح',
  'Withdraw cash from a child&apos;s escrow balance. Admin will process your request.': 'اسحب نقدًا من رصيد ابنك/ابنتك. ستعالج الإدارة طلبك.',
  "Withdraw cash from a child's escrow balance. Admin will process your request.": 'اسحب نقدًا من رصيد ابنك/ابنتك. ستعالج الإدارة طلبك.',
  'Your withdrawal request has been sent to the admin for processing.': 'تم إرسال طلب السحب إلى الإدارة للمعالجة.',
  'Submit another request': 'إرسال طلب آخر',
  'View withdrawal request history': 'عرض سجل طلبات السحب',
  'Select a child above to view their transaction history.': 'اختر ابنًا/ابنة أعلاه لعرض سجل المعاملات.',
  'Transaction History —': 'سجل المعاملات -',
  'Available balance:': 'الرصيد المتاح:',
  'EGP transferred from': 'جنيه تم تحويله من',
  'to': 'إلى',
  'Read-only view. Contact your parent to request withdrawals or transfers.': 'عرض فقط. تواصل مع ولي الأمر لطلب السحب أو التحويل.',
  'File Type': 'نوع الملف',
  'Filter by type:': 'تصفية حسب النوع:',
  'Total:': 'الإجمالي:',
  'Size:': 'الحجم:',
  'Uploaded:': 'تاريخ الرفع:',
  'View': 'عرض',
  'PNG, JPG, GIF up to 5MB. Thumbnails will be generated automatically.': 'PNG وJPG وGIF حتى 5 ميجابايت. سيتم إنشاء الصور المصغرة تلقائيًا.',
  'Created': 'تم الإنشاء',
  'Switch to "All" to see past notifications.': 'انتقل إلى "الكل" لرؤية الإشعارات السابقة.',
  'Awaiting Approval (': 'بانتظار الموافقة (',
  'Processed (': 'تمت المعالجة (',
  '· Submitted': '· تم الإرسال',
  'Processed:': 'تمت المعالجة:',
  'Drop and swap requests waiting for parent approval.': 'طلبات الحذف والتبديل التي تنتظر موافقة ولي الأمر.',
  'Visit your registrations to request a drop or swap.': 'اذهب إلى تسجيلاتك لطلب حذف أو تبديل.',
  'When a parent is linked to your account, they can register subjects on your behalf, view your registration history, and manage your escrow balance. You can approve or reject link requests at any time.': 'عند ربط ولي أمر بحسابك، يمكنه تسجيل المواد نيابة عنك، وعرض سجل التسجيل، وإدارة رصيدك. يمكنك قبول أو رفض طلبات الربط في أي وقت.',
  'Pending Requests (': 'الطلبات المعلقة (',
  'Phone': 'الهاتف',
  'Profile updated successfully': 'تم تحديث الملف الشخصي بنجاح',
  'Failed to load profile': 'تعذر تحميل الملف الشخصي',
  'Failed to update profile': 'تعذر تحديث الملف الشخصي',
  'Congratulations, Graduate!': 'تهانينا أيها الخريج!',
  'Welcome back,': 'مرحبًا بعودتك،',
  'Your student record shows you have graduated. Registration, drop, and swap features are no longer available. If you believe this is an error, please contact the school administration.': 'يشير سجل الطالب إلى أنك تخرجت. لم تعد ميزات التسجيل والحذف والتبديل متاحة. إذا كنت تعتقد أن هذا خطأ، يرجى التواصل مع إدارة المدرسة.',
  '✨ Patterns Demonstrated': '✨ أنماط معروضة',
  '✓': '✓',
  '· Grade': '· الصف',
  '· ID:': '· المعرف:',
  '(Grade': '(الصف',
  'Balance:': 'الرصيد:',
  'Financial impact:': 'الأثر المالي:',
  'from your children.': 'من أبنائك.',
  'Fulfill': 'تنفيذ',
  'Full chain-of-custody record of all system actions. Click any entity ID to view its complete history.': 'سجل كامل لسلسلة المسؤولية لكل إجراءات النظام. اضغط على أي معرف كيان لعرض سجله الكامل.',
  'Go Home': 'العودة للرئيسية',
  'Go to sign in': 'الذهاب لتسجيل الدخول',
  'Grade 10 students are required to register for this subject in the June session.': 'طلاب الصف 10 مطالبون بتسجيل هذه المادة في جلسة يونيو.',
  'I&apos;m a Parent': 'أنا ولي أمر',
  "I'm a Parent": 'أنا ولي أمر',
  'I&apos;m a Student': 'أنا طالب',
  "I'm a Student": 'أنا طالب',
  'If approved,': 'إذا تمت الموافقة،',
  'Incl.': 'يشمل',
  'Include this reference when making the transfer so it can be matched to your account.': 'اذكر هذا المرجع عند إجراء التحويل حتى يمكن مطابقته بحسابك.',
  'January': 'يناير',
  'June': 'يونيو',
  'November': 'نوفمبر',
  'Join our academic': 'انضم إلى مجتمعنا الأكاديمي',
  'journey starts here.': 'تبدأ هنا.',
  'Later': 'لاحقًا',
  'Link children&apos;s accounts': 'ربط حسابات الأبناء',
  "Link children's accounts": 'ربط حسابات الأبناء',
  'Link to your children&apos;s accounts, register subjects on their behalf, and manage escrow transfers.': 'اربط حسابات أبنائك، وسجّل المواد نيابة عنهم، وأدر تحويلات الرصيد.',
  "Link to your children's accounts, register subjects on their behalf, and manage escrow transfers.": 'اربط حسابات أبنائك، وسجّل المواد نيابة عنهم، وأدر تحويلات الرصيد.',
  'Link your children&apos;s accounts': 'اربط حسابات أبنائك',
  "Link your children's accounts": 'اربط حسابات أبنائك',
  'Loading notifications...': 'جار تحميل الإشعارات...',
  'Loading subjects...': 'جار تحميل المواد...',
  'Manage your children&apos;s escrow balances.': 'أدر أرصدة أبنائك.',
  "Manage your children's escrow balances.": 'أدر أرصدة أبنائك.',
  "Manage your children's account links": 'أدر روابط حسابات أبنائك',
  'Move funds between your linked children&apos;s escrow accounts.': 'حوّل الأموال بين حسابات الرصيد الخاصة بأبنائك المرتبطين.',
  "Move funds between your linked children's escrow accounts.": 'حوّل الأموال بين حسابات الرصيد الخاصة بأبنائك المرتبطين.',
  'New End Date': 'تاريخ الانتهاء الجديد',
  'New Session': 'جلسة جديدة',
  "Next step: Link your children's accounts": 'الخطوة التالية: ربط حسابات أبنائك',
  'No edits recorded for this session.': 'لا توجد تعديلات مسجلة لهذه الجلسة.',
  'No files yet. Upload one above!': 'لا توجد ملفات بعد. ارفع ملفًا أعلاه!',
  'No linked children found.': 'لا يوجد أبناء مرتبطون.',
  'No linked children. Go to': 'لا يوجد أبناء مرتبطون. اذهب إلى',
  'No Open Registration Windows': 'لا توجد نوافذ تسجيل مفتوحة',
  'No pending registration requests from your children at this time.': 'لا توجد طلبات تسجيل معلقة من أبنائك حاليًا.',
  'No pending requests.': 'لا توجد طلبات معلقة.',
  'No pending withdrawal requests.': 'لا توجد طلبات سحب معلقة.',
  'No scheduled announcements.': 'لا توجد إعلانات مجدولة.',
  'No subjects have been registered for your children yet.': 'لم يتم تسجيل أي مواد لأبنائك بعد.',
  'No transactions yet.': 'لا توجد معاملات بعد.',
  'No withdrawal requests yet.': 'لا توجد طلبات سحب بعد.',
  'Old price (': 'السعر القديم (',
  'Only one active session of each type is allowed at a time.': 'يُسمح بجلسة نشطة واحدة فقط من كل نوع في نفس الوقت.',
  'Page': 'صفحة',
  'Paid from escrow': 'مدفوع من الرصيد',
  'Parent note:': 'ملاحظة ولي الأمر:',
  'Parent note: &ldquo;': 'ملاحظة ولي الأمر: "',
  'Parent note: "': 'ملاحظة ولي الأمر: "',
  'Parent:': 'ولي الأمر:',
  'Pay this amount at any Fawry outlet within 24 hours. Expires:': 'ادفع هذا المبلغ في أي منفذ فوري خلال 24 ساعة. ينتهي:',
  'Pending and partially-fulfilled escrow withdrawals — oldest first.': 'طلبات السحب المعلقة والمنفذة جزئيًا - الأقدم أولًا.',
  'Resetting...': 'جار إعادة التعيين...',
  'Select Child': 'اختر الطالب',
  'Session:': 'الجلسة:',
  'Student ID': 'رقم الطالب',
  'Submit Request': 'إرسال الطلب',
  'We sent a reset link to': 'أرسلنا رابط إعادة التعيين إلى',
  'Manage connections with your children&apos;s accounts': 'إدارة الروابط مع حسابات أبنائك',
  "Manage connections with your children's accounts": 'إدارة الروابط مع حسابات أبنائك',
  'Avatar uploaded successfully:': 'تم رفع الصورة الشخصية بنجاح:',
  'Failed to upload avatar:': 'تعذر رفع الصورة الشخصية:',
  'CSV download failed:': 'فشل تنزيل CSV:',
  'CSV download error:': 'خطأ في تنزيل CSV:',
  'Profile setup error:': 'خطأ في إعداد الملف الشخصي:',
  'Grade not specified': 'لم يتم تحديد الصف',
  'Audit Log — Admin': 'سجل التدقيق - الإدارة',
  'Dashboard — Admin': 'لوحة التحكم - الإدارة',
  'Bank Transfer Confirmations — IGCSE Admin': 'تأكيدات التحويل البنكي - إدارة IGCSE',
  'Checkout — IGCSE Reservation': 'الدفع - حجز IGCSE',
  'Escrow — IGCSE Reservation': 'الرصيد - حجز IGCSE',
  'My Pending Requests — IGCSE Reservation': 'طلباتي المعلقة - حجز IGCSE',
  'My Registrations — IGCSE Reservation': 'تسجيلاتي - حجز IGCSE',
  'Notifications — IGCSE Reservation': 'الإشعارات - حجز IGCSE',
  'Pending Approvals — IGCSE Reservation': 'الموافقات المعلقة - حجز IGCSE',
  'Register Subjects — IGCSE Reservation': 'تسجيل المواد - حجز IGCSE',
  'Registration History — IGCSE Reservation': 'سجل التسجيل - حجز IGCSE',
  'Reports — Admin': 'التقارير - الإدارة',
  'Request Withdrawal — IGCSE Reservation': 'طلب سحب - حجز IGCSE',
  'Session Management — Admin': 'إدارة الجلسات - الإدارة',
  'Subject Management — Admin': 'إدارة المواد - الإدارة',
  'Subjects — IGCSE Reservation': 'المواد - حجز IGCSE',
  'Transfer Escrow — IGCSE Reservation': 'تحويل الرصيد - حجز IGCSE',
  'Withdrawal Requests — Admin': 'طلبات السحب - الإدارة',
  'IGCSE Subject Reservation': 'حجز مواد IGCSE',
  'IGCSE Subject Registration & Reservation System — manage exam subjects, approvals, payments, and escrow.': 'نظام تسجيل وحجز مواد IGCSE - إدارة مواد الامتحان والموافقات والمدفوعات والأرصدة.',
  '-- | IGCSE Reservation': '-- | حجز IGCSE',
  'active ·': 'نشطة ·',
  'draft ·': 'مسودة ·',
  'total ·': 'إجمالي ·',
  'm remaining': 'دقيقة متبقية',
  'change request': 'طلب تغيير',
  'recovery.': 'الاسترداد.',
  'Step 4': 'الخطوة 4',
  'Failed to load subjects. Please try again.': 'تعذر تحميل المواد. حاول مرة أخرى.',

  // Imported validation labels and generated audit/status labels
  'Change Request': 'طلب تغيير',
  'Notification': 'إشعار',
  'Subject Created': 'تم إنشاء مادة',
  'Subject Updated': 'تم تحديث مادة',
  'Subject Deactivated': 'تم إلغاء تفعيل مادة',
  'Subject Reactivated': 'تم إعادة تفعيل مادة',
  'Core Subject Flag Updated': 'تم تحديث علامة المادة الأساسية',
  'Session Created': 'تم إنشاء جلسة',
  'Session Updated': 'تم تحديث جلسة',
  'Session Activated': 'تم تفعيل جلسة',
  'Session Closed': 'تم إغلاق جلسة',
  'Session Auto-Closed': 'تم إغلاق الجلسة تلقائيًا',
  'Session Auto-Activated': 'تم تفعيل الجلسة تلقائيًا',
  'Registration Request Submitted': 'تم إرسال طلب التسجيل',
  'Direct Registration by Parent': 'تسجيل مباشر بواسطة ولي الأمر',
  'Registration Request Approved': 'تمت الموافقة على طلب التسجيل',
  'Registration Request Rejected': 'تم رفض طلب التسجيل',
  'Admin Override Applied': 'تم تطبيق تجاوز الإدارة',
  'Registration Confirmed (Payment)': 'تم تأكيد التسجيل (الدفع)',
  'Payment Confirmed': 'تم تأكيد الدفع',
  'Payment Failed': 'فشل الدفع',
  'Drop/Swap Request Created': 'تم إنشاء طلب حذف/تبديل',
  'Drop/Swap Request Approved': 'تمت الموافقة على طلب حذف/تبديل',
  'Drop/Swap Request Rejected': 'تم رفض طلب حذف/تبديل',
  'Drop/Swap Request Cancelled': 'تم إلغاء طلب حذف/تبديل',
  'Direct Drop by Parent': 'حذف مباشر بواسطة ولي الأمر',
  'Direct Swap by Parent': 'تبديل مباشر بواسطة ولي الأمر',
  'Escrow Transfer': 'تحويل رصيد',
  'Withdrawal Request Created': 'تم إنشاء طلب سحب',
  'Withdrawal Fulfilled': 'تم تنفيذ السحب',
  'Withdrawal Rejected': 'تم رفض السحب',
  'User Profile Updated': 'تم تحديث ملف المستخدم',
  'Student Grade Changed': 'تم تغيير صف الطالب',
  'Admin Announcement Sent': 'تم إرسال إعلان الإدارة',
  'Pending Parent Approval': 'بانتظار موافقة ولي الأمر',
  'Pending Approval': 'بانتظار الموافقة',
  'Pending Payment': 'بانتظار الدفع',
  'Dropped': 'محذوف',
  'Expired': 'منتهي',
  'Cancelled': 'ملغي',
  '(Parent)': '(ولي الأمر)',
  '(Admin)': '(الإدارة)',
  '(Student)': '(الطالب)',
};

// F0a screens keep their Arabic in lib/i18n-foundation, one file per area.
Object.assign(autoArabicText, foundationArabic);
// F0b screens (lib/i18n-catalogue.ts): only words the app does not already
// translate, so a shared word keeps the Arabic the other screens use.
for (const [en, ar] of Object.entries(catalogueArabic)) if (!(en in autoArabicText)) autoArabicText[en] = ar;
// F7 screens (lib/i18n-import.ts), the same way.
for (const [en, ar] of Object.entries(importArabic)) if (!(en in autoArabicText)) autoArabicText[en] = ar;

const textNodeOriginals = new WeakMap<Text, string>();

function translateDynamicText(text: string): string | null {
  const gradeMatch = /^Grade (\d+)$/.exec(text);
  if (gradeMatch) return `الصف ${gradeMatch[1]}`;

  const gradeParenMatch = /^\(Grade (.+)\)$/.exec(text);
  if (gradeParenMatch) return `(الصف ${gradeParenMatch[1]})`;

  const totalMatch = /^Total: (.+)$/.exec(text);
  if (totalMatch) return `الإجمالي: ${totalMatch[1]}`;

  const pendingMatch = /^Pending Requests \((.+)\)$/.exec(text);
  if (pendingMatch) return `الطلبات المعلقة (${pendingMatch[1]})`;

  const requestedMatch = /^Requested (.+)$/.exec(text);
  if (requestedMatch) return `تم الطلب ${requestedMatch[1]}`;

  const egpTotalMatch = /^EGP (.+) total$/.exec(text);
  if (egpTotalMatch) return `إجمالي ${egpTotalMatch[1]} جنيه`;

  const egpMatch = /^EGP (.+)$/.exec(text);
  if (egpMatch) return `${egpMatch[1]} جنيه`;

  const additionalPaymentNeededMatch = /^-?(.+) EGP additional payment needed$/.exec(text);
  if (additionalPaymentNeededMatch) return `يلزم دفع إضافي ${additionalPaymentNeededMatch[1]} جنيه`;

  const additionalPaymentMatch = /^(.+) EGP additional payment$/.exec(text);
  if (additionalPaymentMatch) return `دفعة إضافية ${additionalPaymentMatch[1]} جنيه`;

  const escrowCreditMatch = /^(.+) EGP escrow credit$/.exec(text);
  if (escrowCreditMatch) return `رصيد مضاف ${escrowCreditMatch[1]} جنيه`;

  const toPayMatch = /^(.+) to pay$/.exec(text);
  if (toPayMatch) return `المطلوب دفعه ${toPayMatch[1]}`;

  const payViaMatch = /^Pay (.+) EGP via (.+)$/.exec(text);
  if (payViaMatch) {
    const method = payViaMatch[2] ?? '';
    return `ادفع ${payViaMatch[1]} جنيه عبر ${translateExactText(method) ?? method}`;
  }

  const rowsMatch = /^(\d+) rows?$/.exec(text);
  if (rowsMatch) return `${rowsMatch[1]} صف`;

  const remainingMinutesMatch = /^(\d+)m remaining$/.exec(text);
  if (remainingMinutesMatch) return `متبقٍ ${remainingMinutesMatch[1]} دقيقة`;

  const sessionStatusSummaryMatch = /^(active|draft|closed) · (.+) total · (.+)$/.exec(text);
  if (sessionStatusSummaryMatch) {
    const status = translateExactText(sessionStatusSummaryMatch[1] ?? '') ?? sessionStatusSummaryMatch[1];
    return `${status} · إجمالي ${sessionStatusSummaryMatch[2]} · ${sessionStatusSummaryMatch[3]}`;
  }

  const subjectSummaryMatch = /^(.+) total · (.+)$/.exec(text);
  if (subjectSummaryMatch) return `إجمالي ${subjectSummaryMatch[1]} · ${subjectSummaryMatch[2]}`;

  const egpAvailableMatch = /^(.+) EGP available$/.exec(text);
  if (egpAvailableMatch) return `${egpAvailableMatch[1]} جنيه متاح`;

  const egpTransferredMatch = /^(.+) EGP transferred from (.+) to (.+)$/.exec(text);
  if (egpTransferredMatch) return `تم تحويل ${egpTransferredMatch[1]} جنيه من ${egpTransferredMatch[2]} إلى ${egpTransferredMatch[3]}`;

  // F0a: "June 2027 series · academic year 2026/27" and a bare "June 2027".
  const seriesSummaryMatch = /^(January|June|October|November) (\d{4}) series · academic year (.+)$/.exec(text);
  if (seriesSummaryMatch) {
    const month = translateExactText(seriesSummaryMatch[1] ?? '') ?? seriesSummaryMatch[1];
    return `دورة ${month} ${seriesSummaryMatch[2]} · العام الدراسي ${seriesSummaryMatch[3]}`;
  }
  const seriesMatch = /^(January|June|October|November) (\d{4})$/.exec(text);
  if (seriesMatch) return `${translateExactText(seriesMatch[1] ?? '') ?? seriesMatch[1]} ${seriesMatch[2]}`;
  // F0a: the API's refusal sentences that carry a name, a date or a year.
  const f0aRefusal = translateFoundationRefusal(text);
  if (f0aRefusal) return f0aRefusal;
  // F0b: the catalogue's, the series' and the enrolment's sentences with names in them.
  const f0bText = translateCatalogueText(text);
  if (f0bText) return f0bText;
  // F7: the import's sentences with a name, a number or a year in them.
  const f7Text = translateImportText(text);
  if (f7Text) return f7Text;

  // Accessible names that carry a person's name (the Team grid).
  const roleOfMatch = /^Role of (.+)$/.exec(text);
  if (roleOfMatch) return `دور ${roleOfMatch[1]}`;
  const teacherRecordForMatch = /^Teacher record for (.+)$/.exec(text);
  if (teacherRecordForMatch) return `سجل المعلم لـ ${teacherRecordForMatch[1]}`;
  // A comma list whose every item is a known word (weekdays, roles).
  if (text.includes(', ')) {
    const parts = text.split(', ').map((p) => autoArabicText[p]);
    if (parts.every(Boolean)) return parts.join('، ');
  }

  const dateMonthMatch = /^(.+?)\b(January|June|October|November)\b(.+)?$/.exec(text);
  if (dateMonthMatch) {
    const month = translateExactText(dateMonthMatch[2] ?? '') ?? dateMonthMatch[2];
    return `${dateMonthMatch[1] ?? ''}${month}${dateMonthMatch[3] ?? ''}`;
  }

  const welcomeMatch = /^Welcome back, (.+)$/.exec(text);
  if (welcomeMatch) return `مرحبًا بعودتك، ${welcomeMatch[1]}`;

  const countPendingChangeRequestsMatch = /^(\d+) pending change requests? from your children\.$/.exec(text);
  if (countPendingChangeRequestsMatch) return `${countPendingChangeRequestsMatch[1]} طلب تغيير معلق من أبنائك.`;

  const approveRegsMatch = /^Approve (\d+) Registrations?$/.exec(text);
  if (approveRegsMatch) return `الموافقة على ${approveRegsMatch[1]} تسجيل`;

  const rejectRegsMatch = /^Reject (\d+) Registrations?$/.exec(text);
  if (rejectRegsMatch) return `رفض ${rejectRegsMatch[1]} تسجيل`;

  const changeRequestCountMatch = /^Show (\d+) change requests?$/.exec(text);
  if (changeRequestCountMatch) return `عرض ${changeRequestCountMatch[1]} طلب تغيير`;

  const ifAccountExistsMatch = /^If an account exists for (.+), we sent a password reset link\. It expires in 24 hours\.$/.exec(text);
  if (ifAccountExistsMatch) return `إذا كان هناك حساب لـ ${ifAccountExistsMatch[1]}، فقد أرسلنا رابط إعادة تعيين كلمة المرور. تنتهي صلاحيته خلال 24 ساعة.`;

  const resetLinkMatch = /^We sent a reset link to (.+)$/.exec(text);
  if (resetLinkMatch) return `أرسلنا رابط إعادة التعيين إلى ${resetLinkMatch[1]}`;

  const registerSubjectsMatch = /^Register (\d+) Subjects? — (.+)$/.exec(text);
  if (registerSubjectsMatch) return `تسجيل ${registerSubjectsMatch[1]} مادة - ${registerSubjectsMatch[2]}`;

  const submitSubjectRequestMatch = /^Submit Request for (\d+) Subjects?$/.exec(text);
  if (submitSubjectRequestMatch) return `إرسال طلب لـ ${submitSubjectRequestMatch[1]} مادة`;

  const stepMatch = /^(Step \d+) — (.+)$/.exec(text);
  if (stepMatch) {
    const step = stepMatch[1] ?? '';
    const label = stepMatch[2] ?? '';
    return `${translateExactText(step) ?? step} - ${translateExactText(label) ?? label}`;
  }

  const uploadFileMatch = /^Upload (.+)$/.exec(text);
  if (uploadFileMatch) return `رفع ${uploadFileMatch[1]}`;

  const deactivateSubjectMatch = /^Deactivate "(.+)"\? It will no longer appear in registration\.$/.exec(text);
  if (deactivateSubjectMatch) return `هل تريد إلغاء تفعيل "${deactivateSubjectMatch[1]}"؟ لن تظهر بعد الآن في التسجيل.`;

  const activateSessionMatch = /^Activate "(.+)"\? Registration will open immediately\.$/.exec(text);
  if (activateSessionMatch) return `هل تريد تفعيل "${activateSessionMatch[1]}"؟ سيفتح التسجيل فورًا.`;

  const closeSessionMatch = /^Close "(.+)" early\? Students will no longer be able to register\.$/.exec(text);
  if (closeSessionMatch) return `هل تريد إغلاق "${closeSessionMatch[1]}" مبكرًا؟ لن يتمكن الطلاب من التسجيل.`;

  const reportByCouncilMatch = /^By council -- (.+) \(EGP\)$/.exec(text);
  if (reportByCouncilMatch) return `حسب المجلس - ${reportByCouncilMatch[1]} (جنيه)`;

  const reportByPaymentMethodMatch = /^By payment method -- (.+) \(EGP\)$/.exec(text);
  if (reportByPaymentMethodMatch) {
    const method = reportByPaymentMethodMatch[1] ?? '';
    return `حسب طريقة الدفع - ${translateExactText(method) ?? method} (جنيه)`;
  }

  const failedLinkStatusMatch = /^Failed to (.+) link request$/.exec(text);
  if (failedLinkStatusMatch) return `تعذر ${failedLinkStatusMatch[1] === 'approve' ? 'قبول' : 'تحديث'} طلب الربط`;

  const linkStatusMatch = /^Link request (.+)!$/.exec(text);
  if (linkStatusMatch) return `تم ${linkStatusMatch[1] === 'approved' ? 'قبول' : 'تحديث'} طلب الربط!`;

  return null;
}

/**
 * F0a's API sentences with a name, a date or a year in them (eligibility,
 * the academic structure). Names and dates stay as the API wrote them.
 */
function translateFoundationRefusal(text: string): string | null {
  const rules: [RegExp, (m: RegExpExecArray) => string][] = [
    // Eligibility (mayRegisterFor)
    [/^Only students can be registered for subjects$/, () => 'يمكن تسجيل الطلاب فقط في المواد'],
    [/^(.+) transferred to another school on (.+) and cannot be registered for new subjects$/, (m) => `انتقل ${m[1]} إلى مدرسة أخرى في ${m[2]} ولا يمكن تسجيله في مواد جديدة`],
    [/^(.+) was withdrawn from the school on (.+) and cannot be registered for new subjects$/, (m) => `انسحب ${m[1]} من المدرسة في ${m[2]} ولا يمكن تسجيله في مواد جديدة`],
    [/^(.+)'s grade is not recorded — an admin records it on the student's page before they can register$/, (m) => `صف ${m[1]} غير مسجل - يسجله المدير من صفحة الطالب قبل أن يتمكن من التسجيل`],
    [/^(.+) starts grade 10 in (.+): the (.+) series comes before that$/, (m) => `يبدأ ${m[1]} الصف 10 في ${m[2]}: دورة ${m[3]} تسبق ذلك`],
    [/^Grade 10 sits the June series only: (.+) is in grade 10 in (.+), so the (.+) series is not open to them\. A coordinator can grant an exception\.$/,
      (m) => `يدخل الصف 10 دورة يونيو فقط: ${m[1]} في الصف 10 في ${m[2]}، لذا دورة ${m[3]} غير متاحة له. يمكن للمنسق منح استثناء.`],
    [/^(.+) finished grade 12 in (.+), and the school does not register graduates for later series$/, (m) => `أنهى ${m[1]} الصف 12 في ${m[2]}، والمدرسة لا تسجل الخريجين في الدورات اللاحقة`],
    [/^(.+) finished grade 12 in (.+): a graduate may register only for the October, November and January series of the academic year right after it$/,
      (m) => `أنهى ${m[1]} الصف 12 في ${m[2]}: يمكن للخريج التسجيل فقط في دورات أكتوبر ونوفمبر ويناير من العام الدراسي التالي مباشرة`],
    // The academic structure
    [/^(\d{4}\/\d{2}) runs from 1 July (\d{4}) to 30 June (\d{4}): its dates must fall inside it$/, (m) => `يمتد ${m[1]} من 1 يوليو ${m[2]} إلى 30 يونيو ${m[3]}: يجب أن تقع تواريخه ضمنه`],
    [/^(\d{4}\/\d{2}) already exists$/, (m) => `${m[1]} موجود بالفعل`],
    [/^These terms would fall outside the year: (.+) — change them first$/, (m) => `ستقع هذه الفصول خارج العام: ${m[1]} - عدّلها أولًا`],
    [/^A term falls inside the school year \((.+)\)$/, (m) => `يجب أن يقع الفصل الدراسي داخل العام الدراسي (${m[1]})`],
    [/^The days fall inside the school year \((.+)\)$/, (m) => `يجب أن تقع الأيام داخل العام الدراسي (${m[1]})`],
    [/^The start date falls inside the school year \((.+)\)$/, (m) => `يجب أن يقع تاريخ البدء داخل العام الدراسي (${m[1]})`],
    [/^It overlaps (.+)$/, (m) => `يتداخل مع ${m[1]}`],
    [/^Those days already have an entry: (.+)$/, (m) => `لهذه الأيام إدخال بالفعل: ${m[1]}`],
    [/^A room named (.+) already exists$/, (m) => `توجد قاعة باسم ${m[1]} بالفعل`],
    [/^That year already has a section named (.+)$/, (m) => `يوجد في ذلك العام فصل باسم ${m[1]} بالفعل`],
    [/^(.+) holds (\d+): it has (\d+), and (\d+) more would not fit$/, (m) => `يتسع ${m[1]} لـ ${m[2]}: فيه ${m[3]}، ولا يتسع لـ ${m[4]} آخرين`],
    [/^(.+) is a grade (\d+) section: (.+)$/, (m) => `${m[1]} فصل للصف ${m[2]}: ${m[3]}`],
    [/^Sections move into the year right after: (.+) rolls into (.+)$/, (m) => `تنتقل الفصول إلى العام التالي مباشرة: ${m[1]} ينتقل إلى ${m[2]}`],
    [/^(\S+) already has a section named (.+) that did not come from (.+) — choose another name for it$/, (m) => `يوجد في ${m[1]} فصل باسم ${m[2]} لم يأتِ من ${m[3]} - اختر له اسمًا آخر`],
    [/^(.+ \(\d{2}:\d{2}–\d{2}:\d{2}\)) and (.+ \(\d{2}:\d{2}–\d{2}:\d{2}\)) overlap$/, (m) => `${m[1]} و${m[2]} متداخلتان`],
  ];
  for (const [re, to] of rules) {
    const m = re.exec(text);
    if (m) return to(m);
  }
  return null;
}

function normalizeSourceText(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&rarr;/g, '→')
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&#x2713;/g, '✓')
    .replace(/\s+/g, ' ')
    .trim();
}

function translateExactText(text: string): string | null {
  const normalized = normalizeSourceText(text);
  return autoArabicText[text] ?? autoArabicText[normalized] ?? translateDynamicText(normalized);
}

function translatePreservingWhitespace(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const translated = translateExactText(trimmed);
  if (!translated) return value;
  const leading = value.match(/^\s*/)?.[0] ?? '';
  const trailing = value.match(/\s*$/)?.[0] ?? '';
  return `${leading}${translated}${trailing}`;
}

function localizeDom(language: Language) {
  if (typeof document === 'undefined') return;

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('[data-i18n-skip="true"]')) return NodeFilter.FILTER_REJECT;
        if (['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA'].includes(parent.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const node of textNodes) {
    if (!textNodeOriginals.has(node)) textNodeOriginals.set(node, node.nodeValue ?? '');
    let original = textNodeOriginals.get(node) ?? '';
    const current = node.nodeValue ?? '';
    const localizedOriginal = translatePreservingWhitespace(original);

    // Text that is neither the recorded source nor this pass's translation of
    // it was written by React since the last pass, so it is the new source —
    // whatever it holds. Requiring letters here put every re-rendered number
    // (a balance that loads after first paint) back to its first value.
    if (current !== original && current !== localizedOriginal) {
      original = current;
      textNodeOriginals.set(node, original);
    }

    const nextValue = language === 'ar' ? translatePreservingWhitespace(original) : original;
    if (node.nodeValue !== nextValue) node.nodeValue = nextValue;
  }

  const attrNames = ['placeholder', 'title', 'aria-label', 'alt'];
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
    for (const attr of attrNames) {
      const current = element.getAttribute(attr);
      if (!current) continue;
      const originalAttr = `data-i18n-original-${attr}`;
      let original = element.getAttribute(originalAttr);
      // As for text: a value that is neither the recorded source nor its
      // translation was written by React since the last pass (a grid cell
      // whose "Enrol X in Y" button became "X: Y with Z"), so it is the new
      // source. Keeping the first one forever put stale names back.
      if (original === null || (current !== original && current !== translatePreservingWhitespace(original))) {
        original = current;
        element.setAttribute(originalAttr, current);
      }
      const nextValue = language === 'ar' ? translatePreservingWhitespace(original) : original;
      if (element.getAttribute(attr) !== nextValue) element.setAttribute(attr, nextValue);
    }
  }
}

type I18nContextValue = {
  language: Language;
  direction: 'ltr' | 'rtl';
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  t: (key: TranslationKey) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window === 'undefined') return 'en';
    const stored = window.localStorage.getItem('language');
    return stored === 'ar' || stored === 'en' ? stored : 'en';
  });

  useEffect(() => {
    const stored = window.localStorage.getItem('language');
    if (stored === 'ar' || stored === 'en') setLanguageState(stored);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.dataset.language = language;
    document.title = language === 'ar' ? 'حجز مواد IGCSE' : 'IGCSE Subject Reservation';
    window.localStorage.setItem('language', language);
  }, [language]);

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => localizeDom(language));
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label', 'alt'],
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [language]);

  useEffect(() => {
    const originalAlert = window.alert;
    const originalConfirm = window.confirm;
    const translateMessage = (message?: string) => {
      if (language !== 'ar' || typeof message !== 'string') return message;
      return translatePreservingWhitespace(message);
    };

    window.alert = (message?: string) => originalAlert.call(window, translateMessage(message));
    window.confirm = (message?: string) => originalConfirm.call(window, translateMessage(message));

    return () => {
      window.alert = originalAlert;
      window.confirm = originalConfirm;
    };
  }, [language]);

  const value = useMemo<I18nContextValue>(() => {
    const setLanguage = (next: Language) => setLanguageState(next);
    return {
      language,
      direction: language === 'ar' ? 'rtl' : 'ltr',
      setLanguage,
      toggleLanguage: () => setLanguageState((current) => (current === 'en' ? 'ar' : 'en')),
      t: (key) => translations[language][key] ?? translations.en[key] ?? key,
    };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within I18nProvider');
  return context;
}
