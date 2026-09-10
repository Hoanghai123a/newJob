import PocketBase from "pocketbase";

const baseUrl = process.env.PB_URL || process.env.VITE_PB_URL;
const adminEmail = process.env.PB_ADMIN_EMAIL;
const adminPassword = process.env.PB_ADMIN_PASSWORD;
const accountPassword = process.env.TEST_ACCOUNT_PASSWORD;

if (!baseUrl || !adminEmail || !adminPassword || !accountPassword) {
  throw new Error(
    "Thiếu PB_URL/VITE_PB_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD hoặc TEST_ACCOUNT_PASSWORD.",
  );
}

const pb = new PocketBase(baseUrl);
pb.autoCancellation(false);
await pb.collection("_superusers").authWithPassword(adminEmail, adminPassword);

async function firstOrCreate(collection, filter, payload) {
  const existing = await pb
    .collection(collection)
    .getFirstListItem(filter)
    .catch(() => null);
  return existing || pb.collection(collection).create(payload);
}

const company = await firstOrCreate("companies", 'code="TESTCO"', {
  code: "TESTCO",
  name: "Công ty Thử Nghiệm QC",
  status: "active",
  address: "Khu Công Nghiệp Thử Nghiệm, Hà Nội",
  hotline: "0900123456",
  email: "testco@example.com",
  max_accounts: 200,
  max_workers: 500,
  max_factories: 20,
  max_file_bytes: 1_000_000_000,
  max_employment_histories: 1_000,
});

const accountSpecs = [
  {
    role: "admin",
    login: "admin",
    full_name: "Quản Trị Viên Test",
    phone: "0900000001",
    employee_code: "ADM01",
  },
  {
    role: "staff",
    login: "staff",
    full_name: "Nhân Viên Tuyển Dụng Test",
    phone: "0900000002",
    employee_code: "STF01",
    bank_name: "MB Bank",
    bank_account_number: "0900000002",
    bank_account_name: "NHAN VIEN TEST",
  },
  {
    role: "user",
    login: "worker1",
    full_name: "Nguyễn Văn Công Nhân A",
    phone: "0900000003",
    employee_code: "NV001",
    cccd: "001200000001",
    bank_name: "Vietcombank",
    bank_account_number: "001100000001",
    bank_account_name: "NGUYEN VAN CONG NHAN A",
  },
];

const users = {};
for (const spec of accountSpecs) {
  const username = `testco__${spec.login}`;
  const payload = {
    username,
    password: accountPassword,
    passwordConfirm: accountPassword,
    role: spec.role,
    full_name: spec.full_name,
    phone: spec.phone,
    employee_code: spec.employee_code,
    tenant_company: company.id,
    must_change_password: false,
    status: "active",
    verified: true,
    bank_name: spec.bank_name || "",
    bank_account_number: spec.bank_account_number || "",
    bank_account_name: spec.bank_account_name || "",
    cccd: spec.cccd || "",
  };
  const existing = await pb
    .collection("users")
    .getFirstListItem(`username="${username}"`)
    .catch(() => null);
  users[spec.login] = existing
    ? await pb.collection("users").update(existing.id, payload)
    : await pb.collection("users").create(payload);
}

const factory = await firstOrCreate(
  "factories",
  `tenant_company="${company.id}" && code="FTEST01"`,
  {
    tenant_company: company.id,
    company: company.id,
    code: "FTEST01",
    name: "Nhà Máy Điện Tử Mẫu 01",
    address: "Lô A1 KCN Thử Nghiệm",
    hotline: "0241234567",
    attendance_cutoff_day: 25,
    advance_limit: 2_000_000,
    status: "active",
    note: "Dữ liệu kiểm thử",
  },
);

await firstOrCreate(
  "factory_managers",
  `tenant_company="${company.id}" && factory="${factory.id}" && staff="${users.staff.id}"`,
  {
    tenant_company: company.id,
    company: company.id,
    factory: factory.id,
    staff: users.staff.id,
    status: "active",
    note: "Phụ trách nhà máy mẫu",
  },
);

const recruitmentEntity = await firstOrCreate(
  "recruitment_entities",
  `tenant_company="${company.id}" && name="Đơn Vị Tuyển Dụng Mẫu A"`,
  {
    tenant_company: company.id,
    company: company.id,
    name: "Đơn Vị Tuyển Dụng Mẫu A",
    address: "Số 10 Đường Mẫu",
    hotline: "0912345678",
    status: "active",
    note: "Dữ liệu kiểm thử",
  },
);

await firstOrCreate(
  "employment_histories",
  `tenant_company="${company.id}" && user="${users.worker1.id}"`,
  {
    tenant_company: company.id,
    company: company.id,
    uid: "TEST-WORKER-001",
    user: users.worker1.id,
    factory: factory.id,
    main_house: recruitmentEntity.id,
    recruiter_staff: users.staff.id,
    employee_code: "NV001",
    worker_name_snapshot: "Nguyễn Văn Công Nhân A",
    worker_cccd_snapshot: "001200000001",
    join_date: "2026-01-01 08:00:00.000Z",
    status: "working",
    note: "Lịch sử mẫu",
  },
);

await firstOrCreate("app_settings", `tenant_company="${company.id}"`, {
  tenant_company: company.id,
  company: company.id,
  company_name: company.name,
  slogan: "Hệ thống quản lý chuẩn hóa",
  address: "Hà Nội",
  hotline: "0900123456",
  email: "testco@example.com",
  advance_limit: 2_000_000,
  advance_reporting_enabled: true,
});

console.log(
  JSON.stringify(
    {
      company: { id: company.id, code: company.code },
      accounts: Object.fromEntries(
        Object.entries(users).map(([login, record]) => [
          login,
          { id: record.id, username: record.username },
        ]),
      ),
      factory: { id: factory.id, code: factory.code },
    },
    null,
    2,
  ),
);
pb.authStore.clear();
