-- Idempotent multicurrency migration: currency catalog, base-currency
-- settings, exchange rates, and the multicurrency/transfer transaction shape.
-- Safe to run repeatedly against the same database (the migrate runner also
-- records applied files, so in practice it runs once).

-- 1. Currency catalog ------------------------------------------------------

CREATE TABLE IF NOT EXISTS currencies (
  code text PRIMARY KEY,
  name text NOT NULL,
  symbol text NOT NULL,
  decimal_places int NOT NULL DEFAULT 2
);

INSERT INTO currencies (code, name, symbol, decimal_places) VALUES
  ('PEN', 'Peruvian Sol', 'S/', 2),
  ('USD', 'US Dollar', '$', 2),
  ('EUR', 'Euro', '€', 2),
  ('JPY', 'Japanese Yen', '¥', 0),
  ('GBP', 'Pound Sterling', '£', 2),
  ('CLP', 'Chilean Peso', '$', 0),
  ('COP', 'Colombian Peso', '$', 2),
  ('BRL', 'Brazilian Real', 'R$', 2),
  ('ARS', 'Argentine Peso', '$', 2),
  ('MXN', 'Mexican Peso', '$', 2),
  ('BOB', 'Boliviano', 'Bs.', 2),
  ('UYU', 'Peso Uruguayo', '$U', 2),
  ('PYG', 'Guarani', '₲', 0),
  ('VES', 'Bolivar Soberano', 'Bs.S', 2),
  ('CAD', 'Canadian Dollar', 'CA$', 2),
  ('AUD', 'Australian Dollar', 'A$', 2),
  ('NZD', 'New Zealand Dollar', 'NZ$', 2),
  ('CHF', 'Swiss Franc', 'CHF', 2),
  ('CNY', 'Yuan Renminbi', '¥', 2),
  ('HKD', 'Hong Kong Dollar', 'HK$', 2),
  ('TWD', 'New Taiwan Dollar', 'NT$', 2),
  ('KRW', 'South Korean Won', '₩', 0),
  ('INR', 'Indian Rupee', '₹', 2),
  ('IDR', 'Rupiah', 'Rp', 2),
  ('MYR', 'Malaysian Ringgit', 'RM', 2),
  ('PHP', 'Philippine Peso', '₱', 2),
  ('SGD', 'Singapore Dollar', 'S$', 2),
  ('THB', 'Baht', '฿', 2),
  ('VND', 'Dong', '₫', 0),
  ('AED', 'UAE Dirham', 'AED', 2),
  ('SAR', 'Saudi Riyal', 'SAR', 2),
  ('ILS', 'New Israeli Sheqel', '₪', 2),
  ('TRY', 'Turkish Lira', '₺', 2),
  ('RUB', 'Russian Ruble', '₽', 2),
  ('ZAR', 'Rand', 'R', 2),
  ('EGP', 'Egyptian Pound', 'E£', 2),
  ('NGN', 'Naira', '₦', 2),
  ('KES', 'Kenyan Shilling', 'KSh', 2),
  ('MAD', 'Moroccan Dirham', 'MAD', 2),
  ('DKK', 'Danish Krone', 'kr', 2),
  ('NOK', 'Norwegian Krone', 'kr', 2),
  ('SEK', 'Swedish Krona', 'kr', 2),
  ('PLN', 'Zloty', 'zł', 2),
  ('CZK', 'Czech Koruna', 'Kč', 2),
  ('HUF', 'Forint', 'Ft', 2),
  ('RON', 'Romanian Leu', 'lei', 2),
  ('ISK', 'Iceland Krona', 'kr', 0),
  ('BHD', 'Bahraini Dinar', 'BD', 3),
  ('KWD', 'Kuwaiti Dinar', 'KD', 3),
  ('OMR', 'Rial Omani', 'OMR', 3),
  ('JOD', 'Jordanian Dinar', 'JD', 3),
  ('TND', 'Tunisian Dinar', 'DT', 3),
  ('AFN', 'Afghani', 'Af', 2),
  ('ALL', 'Lek', 'L', 2),
  ('AMD', 'Armenian Dram', 'AMD', 2),
  ('ANG', 'Netherlands Antillean Guilder', 'ƒ', 2),
  ('AOA', 'Kwanza', 'Kz', 2),
  ('AWG', 'Aruban Florin', 'Afl.', 2),
  ('AZN', 'Azerbaijan Manat', '₼', 2),
  ('BAM', 'Convertible Mark', 'KM', 2),
  ('BBD', 'Barbados Dollar', 'Bds$', 2),
  ('BDT', 'Taka', '৳', 2),
  ('BGN', 'Bulgarian Lev', 'лв', 2),
  ('BIF', 'Burundi Franc', 'FBu', 0),
  ('BMD', 'Bermudian Dollar', 'BD$', 2),
  ('BND', 'Brunei Dollar', 'B$', 2),
  ('BSD', 'Bahamian Dollar', 'B$', 2),
  ('BTN', 'Ngultrum', 'Nu.', 2),
  ('BWP', 'Pula', 'P', 2),
  ('BYN', 'Belarusian Ruble', 'Br', 2),
  ('BZD', 'Belize Dollar', 'BZ$', 2),
  ('CDF', 'Congolese Franc', 'FC', 2),
  ('CRC', 'Costa Rican Colon', '₡', 2),
  ('CUP', 'Cuban Peso', '$MN', 2),
  ('CVE', 'Cabo Verde Escudo', '$', 2),
  ('DJF', 'Djibouti Franc', 'Fdj', 0),
  ('DOP', 'Dominican Peso', 'RD$', 2),
  ('DZD', 'Algerian Dinar', 'DA', 2),
  ('ERN', 'Nakfa', 'Nfk', 2),
  ('ETB', 'Ethiopian Birr', 'Br', 2),
  ('FJD', 'Fiji Dollar', 'FJ$', 2),
  ('FKP', 'Falkland Islands Pound', '£', 2),
  ('GEL', 'Lari', '₾', 2),
  ('GHS', 'Ghana Cedi', '₵', 2),
  ('GIP', 'Gibraltar Pound', '£', 2),
  ('GMD', 'Dalasi', 'D', 2),
  ('GNF', 'Guinean Franc', 'FG', 0),
  ('GTQ', 'Quetzal', 'Q', 2),
  ('GYD', 'Guyana Dollar', 'G$', 2),
  ('HNL', 'Lempira', 'L', 2),
  ('HTG', 'Gourde', 'G', 2),
  ('IQD', 'Iraqi Dinar', 'ID', 3),
  ('IRR', 'Iranian Rial', '﷼', 2),
  ('JMD', 'Jamaican Dollar', 'J$', 2),
  ('KGS', 'Som', 'с', 2),
  ('KHR', 'Riel', '៛', 2),
  ('KMF', 'Comorian Franc', 'CF', 0),
  ('KPW', 'North Korean Won', '₩', 2),
  ('KYD', 'Cayman Islands Dollar', 'CI$', 2),
  ('KZT', 'Tenge', '₸', 2),
  ('LAK', 'Lao Kip', '₭', 2),
  ('LBP', 'Lebanese Pound', 'L£', 2),
  ('LKR', 'Sri Lanka Rupee', 'Rs', 2),
  ('LRD', 'Liberian Dollar', 'L$', 2),
  ('LSL', 'Loti', 'L', 2),
  ('LYD', 'Libyan Dinar', 'LD', 3),
  ('MDL', 'Moldovan Leu', 'L', 2),
  ('MGA', 'Malagasy Ariary', 'Ar', 2),
  ('MKD', 'Denar', 'ден', 2),
  ('MMK', 'Kyat', 'K', 2),
  ('MNT', 'Tugrik', '₮', 2),
  ('MOP', 'Pataca', 'MOP$', 2),
  ('MRU', 'Ouguiya', 'UM', 2),
  ('MUR', 'Mauritius Rupee', '₨', 2),
  ('MVR', 'Rufiyaa', 'Rf', 2),
  ('MWK', 'Malawi Kwacha', 'MK', 2),
  ('MZN', 'Mozambique Metical', 'MT', 2),
  ('NAD', 'Namibia Dollar', 'N$', 2),
  ('NIO', 'Cordoba Oro', 'C$', 2),
  ('NPR', 'Nepalese Rupee', '₨', 2),
  ('PAB', 'Balboa', 'B/.', 2),
  ('PGK', 'Kina', 'K', 2),
  ('PKR', 'Pakistan Rupee', '₨', 2),
  ('QAR', 'Qatari Rial', 'QR', 2),
  ('RSD', 'Serbian Dinar', 'дин', 2),
  ('RWF', 'Rwanda Franc', 'FRw', 0),
  ('SBD', 'Solomon Islands Dollar', 'SI$', 2),
  ('SCR', 'Seychelles Rupee', '₨', 2),
  ('SDG', 'Sudanese Pound', 'SDG', 2),
  ('SHP', 'Saint Helena Pound', '£', 2),
  ('SLE', 'Leone', 'Le', 2),
  ('SOS', 'Somali Shilling', 'Sh', 2),
  ('SRD', 'Surinam Dollar', '$', 2),
  ('SSP', 'South Sudanese Pound', 'SSP', 2),
  ('STN', 'Dobra', 'Db', 2),
  ('SYP', 'Syrian Pound', 'LS', 2),
  ('SZL', 'Lilangeni', 'L', 2),
  ('TJS', 'Somoni', 'SM', 2),
  ('TMT', 'Turkmenistan New Manat', 'm', 2),
  ('TOP', 'Pa''anga', 'T$', 2),
  ('TTD', 'Trinidad and Tobago Dollar', 'TT$', 2),
  ('TZS', 'Tanzanian Shilling', 'TSh', 2),
  ('UAH', 'Hryvnia', '₴', 2),
  ('UGX', 'Uganda Shilling', 'USh', 0),
  ('UZS', 'Uzbekistan Sum', 'so''m', 2),
  ('VUV', 'Vatu', 'VT', 0),
  ('WST', 'Tala', 'WS$', 2),
  ('XAF', 'CFA Franc BEAC', 'FCFA', 0),
  ('XCD', 'East Caribbean Dollar', 'EC$', 2),
  ('XOF', 'CFA Franc BCEAO', 'CFA', 0),
  ('XPF', 'CFP Franc', '₣', 0),
  ('YER', 'Yemeni Rial', '﷼', 2),
  ('ZMW', 'Zambian Kwacha', 'ZK', 2),
  ('ZWG', 'Zimbabwe Gold', 'ZiG', 2)
ON CONFLICT (code) DO NOTHING;

-- 2. Single-row settings ----------------------------------------------------

CREATE TABLE IF NOT EXISTS settings (
  id int PRIMARY KEY CHECK (id = 1),
  base_currency_code text NOT NULL REFERENCES currencies(code),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

INSERT INTO settings (id, base_currency_code) VALUES (1, 'PEN')
ON CONFLICT (id) DO NOTHING;

-- 3. Exchange rates ----------------------------------------------------------
-- Direction convention: rate = units of quote_code per 1 unit of base_code,
-- so 1 USD = 3.74 PEN is the row ('USD', 'PEN', date, 3.74).

CREATE TABLE IF NOT EXISTS exchange_rates (
  base_code text NOT NULL REFERENCES currencies(code),
  quote_code text NOT NULL REFERENCES currencies(code),
  date date NOT NULL,
  rate numeric(20, 10) NOT NULL CHECK (rate > 0),
  source text NOT NULL CHECK (source IN ('exchangerate-api', 'exchangerate-host', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  PRIMARY KEY (base_code, quote_code, date)
);

-- 4. Normalize legacy free-text currency values, absorb unknown codes into
--    the catalog, then add the FKs. The absorb step guarantees the FK adds
--    can never fail on legacy data.

UPDATE accounts SET currency = upper(trim(currency));
UPDATE transactions SET currency = upper(trim(currency));

INSERT INTO currencies (code, name, symbol, decimal_places)
SELECT DISTINCT legacy.currency, legacy.currency, legacy.currency, 2
FROM (
  SELECT currency FROM accounts
  UNION
  SELECT currency FROM transactions
) AS legacy
WHERE legacy.currency IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM currencies known WHERE known.code = legacy.currency);

DO $$
BEGIN
  ALTER TABLE accounts
    ADD CONSTRAINT accounts_currency_fkey
    FOREIGN KEY (currency) REFERENCES currencies(code);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE transactions
    ADD CONSTRAINT transactions_currency_fkey
    FOREIGN KEY (currency) REFERENCES currencies(code);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. New transaction columns --------------------------------------------------

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payee text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS base_amount numeric(14, 2);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS rate_used numeric(20, 10);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS to_account_id uuid REFERENCES accounts(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS to_amount numeric(14, 2);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_id text;

DO $$
BEGIN
  ALTER TABLE transactions
    ADD CONSTRAINT transactions_external_id_key UNIQUE (external_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 6. Backfills, then NOT NULL and checks ---------------------------------------

UPDATE transactions SET occurred_at = created_at WHERE occurred_at IS NULL;
ALTER TABLE transactions ALTER COLUMN occurred_at SET NOT NULL;

UPDATE transactions
SET type = CASE WHEN amount < 0 THEN 'expense' ELSE 'income' END
WHERE type IS NULL;
ALTER TABLE transactions ALTER COLUMN type SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE transactions
    ADD CONSTRAINT transactions_type_check
    CHECK (type IN ('expense', 'income', 'transfer'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- category_id: required for expense/income, forbidden for transfers.
ALTER TABLE transactions ALTER COLUMN category_id DROP NOT NULL;

DO $$
BEGIN
  ALTER TABLE transactions
    ADD CONSTRAINT transactions_transfer_shape
    CHECK (
      (type = 'transfer' AND to_account_id IS NOT NULL AND to_amount IS NOT NULL AND category_id IS NULL)
      OR
      (type <> 'transfer' AND to_account_id IS NULL AND to_amount IS NULL AND category_id IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 7. Indexes -------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at
  ON transactions (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_account
  ON transactions (account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type
  ON transactions (type);
