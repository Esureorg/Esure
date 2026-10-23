/**
 * Developer-friendly interpretation of Stellar transaction and operation result codes.
 *
 * This module maps low-level Stellar result codes to actionable error messages
 * that explain what went wrong and how to fix it.
 */

export interface StellarErrorInterpretation {
  /** Short technical summary */
  summary: string;
  /** Plain-English explanation of what went wrong */
  explanation: string;
  /** Common causes of this error */
  causes: string[];
  /** Suggested fixes */
  suggestions?: string[];
  /** Whether this error can be retried */
  retryable: boolean;
}

/**
 * Transaction-level result code interpretations.
 * https://developers.stellar.org/docs/data/horizon/api-reference/errors/result-codes/transactions
 */
const TRANSACTION_CODE_INTERPRETATIONS: Record<string, StellarErrorInterpretation> = {
  tx_failed: {
    summary: "Transaction failed",
    explanation: "The transaction was well-formed but one or more operations failed.",
    causes: ["Operation-level errors (check operation codes for details)"],
    retryable: false,
  },
  tx_too_early: {
    summary: "Transaction submitted too early",
    explanation: "The transaction's time bounds specify it cannot be executed until a future time.",
    causes: ["Transaction minTime is in the future"],
    suggestions: ["Wait until the minTime before submitting", "Adjust time bounds if incorrect"],
    retryable: true,
  },
  tx_too_late: {
    summary: "Transaction submitted too late",
    explanation: "The transaction's time bounds have expired.",
    causes: ["Transaction maxTime is in the past", "Network delays caused late submission"],
    suggestions: ["Generate a new transaction with updated time bounds", "Increase time bound window to account for delays"],
    retryable: true,
  },
  tx_missing_operation: {
    summary: "Transaction has no operations",
    explanation: "The transaction does not contain any operations.",
    causes: ["Empty operations array in transaction"],
    suggestions: ["Add at least one operation to the transaction"],
    retryable: false,
  },
  tx_bad_seq: {
    summary: "Invalid sequence number",
    explanation: "The transaction's sequence number does not match the source account's expected next sequence.",
    causes: [
      "Account sequence number changed (another transaction was submitted)",
      "Using stale account data",
      "Sequence number was manually set incorrectly"
    ],
    suggestions: [
      "Fetch fresh account data and use current sequence + 1",
      "Implement proper sequence number management for concurrent transactions",
      "Ensure only one transaction per account is in flight at a time"
    ],
    retryable: true,
  },
  tx_bad_auth: {
    summary: "Invalid signatures",
    explanation: "The transaction does not have valid signatures for the source account.",
    causes: [
      "Missing required signatures",
      "Incorrect signature weights",
      "Wrong signing keys used"
    ],
    suggestions: [
      "Verify all required signers have signed the transaction",
      "Check signature weights meet threshold requirements",
      "Ensure signing with correct keypairs for the account"
    ],
    retryable: false,
  },
  tx_insufficient_balance: {
    summary: "Insufficient balance for transaction fees",
    explanation: "The source account does not have enough XLM to pay the transaction fee.",
    causes: [
      "Account balance below base reserve + fees",
      "Underestimating transaction fees"
    ],
    suggestions: [
      "Ensure account has enough XLM for fees and reserves",
      "Fund the account before submitting",
      "Reduce number of operations to lower fees"
    ],
    retryable: true,
  },
  tx_no_source_account: {
    summary: "Source account does not exist",
    explanation: "The transaction's source account has not been created on the network.",
    causes: [
      "Account was never funded",
      "Account was merged into another account",
      "Using wrong network (Testnet vs Mainnet)"
    ],
    suggestions: [
      "Fund the account through Friendbot (Testnet) or create account operation",
      "Verify account public key is correct",
      "Check you're on the correct network"
    ],
    retryable: true,
  },
  tx_insufficient_fee: {
    summary: "Transaction fee too low",
    explanation: "The fee offered is below the network's minimum or base fee.",
    causes: [
      "Fee set below BASE_FEE",
      "Network surge pricing not accounted for"
    ],
    suggestions: [
      "Set fee to at least BASE_FEE * number of operations",
      "Check current network fee stats and adjust accordingly"
    ],
    retryable: true,
  },
  tx_internal_error: {
    summary: "Internal Stellar error",
    explanation: "An unexpected error occurred within the Stellar protocol.",
    causes: ["Stellar network internal issue", "Horizon server problem"],
    suggestions: ["Retry the transaction", "Contact Stellar support if issue persists"],
    retryable: true,
  },
  tx_not_supported: {
    summary: "Transaction type not supported",
    explanation: "This transaction uses features not yet supported by the network.",
    causes: ["Protocol version mismatch", "Feature not enabled on this network"],
    suggestions: ["Check protocol version", "Use supported transaction features"],
    retryable: false,
  },
};

/**
 * Operation-level result code interpretations.
 * https://developers.stellar.org/docs/data/horizon/api-reference/errors/result-codes/operations
 */
const OPERATION_CODE_INTERPRETATIONS: Record<string, StellarErrorInterpretation> = {
  op_inner: {
    summary: "Operation-specific error",
    explanation: "The operation failed for a reason specific to its type. Check the specific operation result code.",
    causes: ["Varies by operation type"],
    retryable: false,
  },
  op_bad_auth: {
    summary: "Insufficient authorization",
    explanation: "The operation lacks required signatures or authorization.",
    causes: [
      "Missing signatures from required signers",
      "Signature weights below threshold",
      "Source account does not have permission"
    ],
    suggestions: [
      "Add required signatures",
      "Verify signature weights",
      "Check account authorization settings"
    ],
    retryable: false,
  },
  op_no_source_account: {
    summary: "Operation source account does not exist",
    explanation: "The operation's source account is not found on the network.",
    causes: ["Account was never created", "Account was merged", "Wrong public key"],
    suggestions: ["Create the account first", "Verify account exists on the network"],
    retryable: true,
  },
  op_not_supported: {
    summary: "Operation not supported",
    explanation: "This operation type is not supported by the current protocol version.",
    causes: ["Protocol upgrade required", "Feature not available on this network"],
    suggestions: ["Check network protocol version", "Use supported operations"],
    retryable: false,
  },
  op_too_many_subentries: {
    summary: "Too many sub-entries",
    explanation: "The account has reached the maximum number of sub-entries (trustlines, offers, data entries).",
    causes: ["Account at 1000 sub-entry limit"],
    suggestions: ["Remove unused trustlines or offers", "Use a different account"],
    retryable: false,
  },
  op_exceeded_work_limit: {
    summary: "Operation exceeded work limit",
    explanation: "The operation requires more computational work than allowed in a single ledger.",
    causes: ["Too many path payment operations", "Complex operation chain"],
    suggestions: ["Split operation into multiple transactions", "Simplify operation"],
    retryable: false,
  },
  op_no_trust: {
    summary: "Trustline does not exist",
    explanation: "The destination account has not established a trustline for this asset.",
    causes: [
      "Recipient never created trustline",
      "Trustline was removed",
      "Wrong asset code or issuer"
    ],
    suggestions: [
      "Recipient must create trustline before receiving asset",
      "Verify asset code and issuer are correct",
      "Check trustline still exists"
    ],
    retryable: true,
  },
  op_underfunded: {
    summary: "Insufficient balance",
    explanation: "The source account does not have enough of the asset to complete the operation.",
    causes: [
      "Trying to send more than available balance",
      "Not accounting for minimum balance reserve",
      "Balance consumed by another transaction"
    ],
    suggestions: [
      "Verify account has sufficient balance",
      "Account for minimum XLM reserve requirements",
      "Reduce payment amount",
      "Fund account before retrying"
    ],
    retryable: true,
  },
  op_line_full: {
    summary: "Trustline limit exceeded",
    explanation: "The destination trustline would exceed its limit if this operation succeeded.",
    causes: [
      "Payment amount + current balance > trustline limit",
      "Trustline limit set too low"
    ],
    suggestions: [
      "Recipient should increase trustline limit",
      "Reduce payment amount",
      "Send in multiple smaller payments"
    ],
    retryable: true,
  },
  op_no_issuer: {
    summary: "Asset issuer does not exist",
    explanation: "The asset's issuing account does not exist on the network.",
    causes: [
      "Issuer account was never created",
      "Issuer account was merged",
      "Wrong issuer public key"
    ],
    suggestions: [
      "Verify issuer account exists",
      "Check asset issuer public key is correct",
      "Ensure issuer account is funded"
    ],
    retryable: true,
  },
  op_low_reserve: {
    summary: "Insufficient XLM reserve",
    explanation: "The operation would put the account below the minimum XLM reserve requirement.",
    causes: [
      "Account balance would drop below (2 + number of entries) * base reserve",
      "Not accounting for reserve requirements"
    ],
    suggestions: [
      "Maintain minimum XLM balance: (2 + sub-entries) * 0.5 XLM",
      "Fund account with more XLM",
      "Remove unused trustlines/offers to reduce reserve requirement"
    ],
    retryable: true,
  },
  op_not_authorized: {
    summary: "Not authorized",
    explanation: "The source account is not authorized to perform this operation on this asset.",
    causes: [
      "Asset issuer has not authorized the account",
      "Authorization was revoked",
      "Asset requires authorization"
    ],
    suggestions: [
      "Request authorization from asset issuer",
      "Check asset authorization flags",
      "Verify account has required authorization"
    ],
    retryable: true,
  },
  op_malformed: {
    summary: "Malformed operation",
    explanation: "The operation is invalid or contains illegal parameters.",
    causes: [
      "Invalid amount (negative, zero, or too large)",
      "Invalid asset code or issuer",
      "Invalid operation parameters"
    ],
    suggestions: [
      "Verify all operation parameters are valid",
      "Check amount is positive and within limits",
      "Validate asset codes and public keys"
    ],
    retryable: false,
  },
  op_no_destination: {
    summary: "Destination account does not exist",
    explanation: "The payment destination account has not been created on the network.",
    causes: [
      "Destination was never funded",
      "Destination was merged",
      "Wrong destination public key"
    ],
    suggestions: [
      "Create destination account first with create account operation",
      "For XLM payments, send ≥1 XLM to create account automatically",
      "Verify destination public key is correct"
    ],
    retryable: true,
  },
  op_src_not_authorized: {
    summary: "Source not authorized",
    explanation: "The operation's source account is not authorized for this asset.",
    causes: [
      "Asset issuer has not authorized source account",
      "Authorization flags not set correctly"
    ],
    suggestions: [
      "Source account must request authorization from issuer",
      "Check asset authorization requirements"
    ],
    retryable: true,
  },
  op_src_no_trust: {
    summary: "Source has no trustline",
    explanation: "The operation's source account has not established a trustline for this asset.",
    causes: ["Source account never created required trustline"],
    suggestions: ["Source account must create trustline first"],
    retryable: true,
  },
};

/**
 * Get developer-friendly interpretation for a Stellar transaction result code.
 */
export function interpretTransactionCode(code: string): StellarErrorInterpretation {
  return TRANSACTION_CODE_INTERPRETATIONS[code] ?? {
    summary: `Unknown transaction error: ${code}`,
    explanation: "This transaction error code is not recognized. It may be from a newer protocol version.",
    causes: ["Unknown error code"],
    suggestions: ["Check Stellar documentation for this code", "Verify you're using the latest SDK version"],
    retryable: false,
  };
}

/**
 * Get developer-friendly interpretation for a Stellar operation result code.
 */
export function interpretOperationCode(code: string): StellarErrorInterpretation {
  return OPERATION_CODE_INTERPRETATIONS[code] ?? {
    summary: `Unknown operation error: ${code}`,
    explanation: "This operation error code is not recognized. It may be from a newer protocol version.",
    causes: ["Unknown error code"],
    suggestions: ["Check Stellar documentation for this code", "Verify you're using the latest SDK version"],
    retryable: false,
  };
}

/**
 * Generate a comprehensive human-readable error message from Stellar result codes.
 */
export function explainStellarError(
  transactionCode: string,
  operationCodes: string[],
): string {
  const txInterpretation = interpretTransactionCode(transactionCode);
  const parts: string[] = [];

  parts.push(`Transaction failed: ${txInterpretation.summary}`);
  parts.push(`\nExplanation: ${txInterpretation.explanation}`);

  if (operationCodes.length > 0) {
    parts.push("\n\nOperation errors:");
    for (const [index, opCode] of operationCodes.entries()) {
      const opInterpretation = interpretOperationCode(opCode);
      parts.push(`\n  Operation ${index + 1}: ${opInterpretation.summary}`);
      parts.push(`  ${opInterpretation.explanation}`);
      if (opInterpretation.suggestions && opInterpretation.suggestions.length > 0) {
        parts.push(`  Suggestions: ${opInterpretation.suggestions.join("; ")}`);
      }
    }
  }

  if (txInterpretation.suggestions && txInterpretation.suggestions.length > 0) {
    parts.push(`\n\nSuggestions: ${txInterpretation.suggestions.join("; ")}`);
  }

  return parts.join("");
}

/**
 * Determine if a Stellar error is potentially retryable.
 */
export function isStellarErrorRetryable(
  transactionCode: string,
  operationCodes: string[],
): boolean {
  const txInterpretation = interpretTransactionCode(transactionCode);
  if (!txInterpretation.retryable) return false;

  // If transaction is retryable but any operation is not, consider non-retryable
  for (const opCode of operationCodes) {
    const opInterpretation = interpretOperationCode(opCode);
    if (!opInterpretation.retryable) return false;
  }

  return true;
}
