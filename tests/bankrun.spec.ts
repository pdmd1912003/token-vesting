import * as anchor from "@coral-xyz/anchor";
import { BankrunProvider } from "anchor-bankrun";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BN, Program } from "@coral-xyz/anchor";
import {
  startAnchor,
  BanksClient,
  ProgramTestContext,
  
} from "solana-bankrun";
import { createMint, mintTo ,getAccount} from "spl-token-bankrun";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import IDL from "../target/idl/token_vesting.json";
import { TokenVesting } from "../target/types/token_vesting";

describe("Vesting Smart Contract Test", () => {
  const companyName = "Company";
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;
  let program: Program<TokenVesting>;
  let programBeneficiary: Program<TokenVesting>;
  let employer: Keypair;
  let beneficiary: Keypair;
  let mint: PublicKey;
  let vestingAccount: PublicKey;
  let treasuryTokenAccount: PublicKey;
  let employeeAccount: PublicKey;
  let employeeTokenAccount: PublicKey;

  before(async () => {
    beneficiary = Keypair.generate();
    context = await startAnchor(
      "",
      [{ name: "token_vesting", programId: new PublicKey(IDL.address) }],
      [
        {
          address: beneficiary.publicKey,
          info: { lamports: 1_000_000_000, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false },
        },
      ]
    );

    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    banksClient = context.banksClient;

    program = new Program<TokenVesting>(IDL as TokenVesting, provider);
    employer = provider.wallet.payer;
    console.log("Employer Pubkey:", employer.publicKey.toBase58());
    
    mint = await createMint(banksClient, employer, employer.publicKey, null, 2);
    console.log("Mint Address:", mint.toBase58());  
    // Derive PDAs
    [vestingAccount] = PublicKey.findProgramAddressSync([Buffer.from(companyName)], program.programId);
    console.log("VestingAccount PDA:", vestingAccount.toBase58());
    [treasuryTokenAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_treasury"), Buffer.from(companyName)],
      program.programId
    );
    console.log("Treasury Token PDA:", treasuryTokenAccount.toBase58());

    [employeeAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("employee_vesting"),
        beneficiary.publicKey.toBuffer(),
        vestingAccount.toBuffer(),
      ],
      program.programId
    );
    console.log("Employee Account PDA:", employeeAccount.toBase58());

    // Beneficiary context
    const beneficiaryProvider = new BankrunProvider(context);
    beneficiaryProvider.wallet = new NodeWallet(beneficiary);
    programBeneficiary = new Program<TokenVesting>(IDL as TokenVesting, beneficiaryProvider);

    // Derive employee ATA (Associated Token Account)
    employeeTokenAccount = await anchor.utils.token.associatedAddress({
      mint,
      owner: beneficiary.publicKey,
    });
  });

  it("should create vesting account", async () => {
    const tx = await program.methods
    .createVestingAccount(companyName)
    .accounts({
      signer: employer.publicKey,
      vestingAccount,
      mint,
      treasuryTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(" Vesting account created:", tx);
  });

  it("should fund the treasury", async () => {
    const amount = 1_000_000;
    const sig = await mintTo(
      banksClient,
      employer,
      mint,
      treasuryTokenAccount,
      employer,
      amount
    );
    console.log("Minted to treasury:", sig);
  });

  it("should create employee vesting", async () => {
    const start = 0;
    const end = 100;
    const total = 1_000_000;
    const cliff = 0;

    const tx = await program.methods
    .createEmployeeVesting(new BN(start), new BN(end), new BN(total), new BN(cliff))
    .accounts({
      owner: employer.publicKey,
      beneficiary: beneficiary.publicKey,
      vestingAccount,
      employeeAccount,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("Employee vesting account created:", tx);
  });

  it("should claim tokens", async () => {
    const sig = await programBeneficiary.methods
      .claimTokens(companyName)
      .accounts({
        beneficiary: beneficiary.publicKey,
        employeeAccount,
        vestingAccount,
        mint,
        treasuryTokenAccount,
        employeeTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Claimed tokens:", sig);
    const ataInfo = await getAccount(banksClient, employeeTokenAccount);
    console.log("Employee ATA balance:", Number(ataInfo.amount));
  });
});
