-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateTable
CREATE TABLE "Account" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebitAccount" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "balance" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "DebitAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditAccount" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "creditLine" DECIMAL(65,30) NOT NULL,
    "closingDay" INTEGER NOT NULL,
    "lastPaymentDay" INTEGER NOT NULL,

    CONSTRAINT "CreditAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "parentId" INTEGER,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "categoryId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DebitAccount_accountId_key" ON "DebitAccount"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditAccount_accountId_key" ON "CreditAccount"("accountId");

-- AddForeignKey
ALTER TABLE "DebitAccount" ADD CONSTRAINT "DebitAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
