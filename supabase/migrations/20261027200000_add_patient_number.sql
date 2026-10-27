BEGIN;

LOCK TABLE public.patients IN ACCESS EXCLUSIVE MODE;

CREATE SEQUENCE IF NOT EXISTS public.patients_patient_number_seq AS bigint;

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS patient_number bigint;

WITH numbered_patients AS (
  SELECT
    id,
    COALESCE((SELECT MAX(patient_number) FROM public.patients), 0)
      + ROW_NUMBER() OVER (ORDER BY created_at NULLS FIRST, id) AS patient_number
  FROM public.patients
  WHERE patient_number IS NULL
)
UPDATE public.patients AS patients
SET patient_number = numbered_patients.patient_number
FROM numbered_patients
WHERE patients.id = numbered_patients.id;

SELECT setval(
  'public.patients_patient_number_seq',
  COALESCE(MAX(patient_number), 1),
  MAX(patient_number) IS NOT NULL
)
FROM public.patients;

ALTER TABLE public.patients
  ALTER COLUMN patient_number SET DEFAULT nextval('public.patients_patient_number_seq'),
  ALTER COLUMN patient_number SET NOT NULL;

ALTER SEQUENCE public.patients_patient_number_seq
  OWNED BY public.patients.patient_number;

GRANT USAGE, SELECT ON SEQUENCE public.patients_patient_number_seq
  TO anon, authenticated, service_role;

CREATE UNIQUE INDEX IF NOT EXISTS patients_patient_number_key
  ON public.patients (patient_number);

COMMIT;
