# FastMCP Security Guideline Document

This document outlines the security principles and requirements for the FastMCP project, a TypeScript framework for building Model Context Protocol (MCP) servers. It highlights critical security measures tailored to the unique features and workflow of FastMCP.

---

## 1. Overview

- **FastMCP** enables developers to build MCP servers with features such as tool execution with schema validation, resource management with URI templating, and prompt management.
- It supports multiple core functionalities:
  - **Tools:** Executable functions with schema validation (using Zod, ArkType, or Valibot).
  - **Resources:** Data availability via URIs and templating support.
  - **Prompts:** Reusable prompt templates.
  - **Authentication:** Custom, robust authentication mechanisms.
  - **Sessions:** Secure session management and real-time updates via SSE.
  - **CLI Tools:** `fastmcp dev` for testing and `fastmcp inspect` for web UI inspection.

---

## 2. Security by Design Principles

- **Security by Design:** Integrate security considerations from design through deployment.
- **Least Privilege:** Grant only necessary permissions to components and users.
- **Defense in Depth:** Implement layered security controls to ensure resilience.
- **Secure Defaults:** Ensure components are configured with secure settings by default.

---

## 3. Authentication & Access Control

- **Robust Authentication:** 
  - Use custom authentication functions to validate users.
  - Consider multi-factor authentication (MFA) for sensitive operations.
- **Strong Password Policies:** 
  - Enforce complexity, length, and rotation on passwords.
  - Utilize strong hashing (Argon2, bcrypt) with unique salts.
- **Secure Session Management:** 
  - Generate unpredictable session IDs.
  - Manage idle and absolute timeouts.
  - Protect against session fixation and ensure proper logout procedures.
- **Role-Based Access Control (RBAC):** 
  - Ensure authorization checks to prevent privilege escalation.
  - Validate tokens and permissions on every sensitive operation.

---

## 4. Input Handling & Processing

- **Schema Validation:** 
  - Use Zod, Valibot, or ArkType for rigorous input validation to prevent injection attacks.
  - Consistently validate all API inputs (e.g., `ListTools`, `CallTool`, etc.).
- **Sanitization & Output Encoding:** 
  - Sanitize all inputs to prevent XSS and other injection attacks.
  - Use proper output encoding when rendering user-supplied data.
- **File Uploads & Command Execution:**
  - Validate file types, extensions, and sizes.
  - Prevent path traversal and ensure safe execution using secure libraries like `execa`.
- **Validation & Sanitization Strategy:**
  - Apply server-side validation in conjunction with client-side checks, never relying solely on the latter.

---

## 5. Data Protection & Privacy

- **Encryption in Transit and at Rest:**
  - Use TLS (1.2+) for all communications, especially for SSE.
  - Encrypt sensitive data stored in databases, using strong encryption algorithms (e.g., AES-256).
- **Strong Cryptography:**
  - Use modern encryption algorithms and secure hashing functions.
  - Avoid storing sensitive information in plaintext.
- **Secrets Management:**
  - Avoid hardcoding credentials or keys in source code.
  - Use dedicated secret management solutions where applicable.

---

## 6. API & Service Security

- **HTTPS Enforcement:** 
  - Mandate HTTPS for all API endpoints.
- **Rate Limiting & Throttling:**
  - Implement mechanisms to mitigate DoS and brute-force attacks.
- **CORS & Security Headers:**
  - Implement restrictive CORS policies.
  - Use headers such as Content-Security-Policy (CSP), HTTP Strict Transport Security (HSTS), X-Content-Type-Options, and X-Frame-Options.
- **API Versioning:**
  - Manage and gracefully handle API version changes to prevent security lapses during transitions.

---

## 7. Session and SSE Security

- **Session Management:**
  - Securely create, manage, and terminate client sessions.
  - Generate secure session tokens that are unpredictable.
- **SSE Communication:**
  - Secure real-time updates with TLS.
  - Validate and authenticate SSE streams to prevent unauthorized access.

---

## 8. Logging and Error Handling

- **Comprehensive Logging:**
  - Implement logging for auditing security events, tool executions, and error handling.
  - Ensure logs do not expose sensitive information.
- **Fail Securely:**
  - Configure error messages to be clear without divulging internal state or sensitive data.

---

## 9. CLI Tools Security

- **Access Control for CLI:**
  - Secure CLI endpoints and ensure only authorized users can run commands such as `fastmcp dev` and `fastmcp inspect`.
- **Input Validation:**
  - Apply strict input validation for CLI arguments using libraries like `yargs`.

---

## 10. Dependency Management

- **Secure Dependencies:**
  - Regularly update third-party libraries and frameworks.
  - Use dependency management tools and lockfiles (e.g., `package-lock.json`) to ensure stability.
- **Vulnerability Scanning:**
  - Integrate Software Composition Analysis (SCA) tools to track known vulnerabilities in components.

---

## 11. Infrastructure & Configuration Management

- **Server Hardening:**
  - Follow best practices for hardening operating systems and server configurations.
  - Disable default accounts, unnecessary services, and debug modes in production.
- **Secure TLS/SSL Configuration:**
  - Use updated protocols and strong cipher suites while disabling outdated protocols.

---

## 12. Final Recommendations

- **Security Testing:**
  - Regularly conduct security audits, penetration tests, and code reviews to identify potential vulnerabilities.
- **Keep It Simple:**
  - Prefer simple, transparent security mechanisms to complex solutions that may introduce additional risks.
- **Documentation:**
  - Maintain thorough documentation of security policies, configurations, and incident response plans to assist in future audits and improvements.

---

By adhering to these guidelines, the FastMCP project will be better positioned to mitigate risks and ensure a robust, secure application framework. Every component from authentication to API management must be developed with security first, ensuring the protection of sensitive data and the overall integrity of the system.
