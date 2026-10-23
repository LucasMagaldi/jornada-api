-- AlterTable
ALTER TABLE "Cargo" ADD COLUMN     "setor" TEXT;

-- AlterTable
ALTER TABLE "Unidade" ADD COLUMN     "bandeira" TEXT,
ADD COLUMN     "pico" JSONB,
ADD COLUMN     "regional" TEXT;
