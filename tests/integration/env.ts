// Point every server module at the disposable test database before anything connects.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/qoc_test";
process.env.RESEND_API_KEY = "";
process.env.EMAIL_FROM = "";
process.env.APP_URL = "http://localhost:3000";
