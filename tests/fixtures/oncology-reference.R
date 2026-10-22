# Regenerates tests/fixtures/oncology-reference.json with R reference implementations.
# Packages: survival (>= 3.0), cmprsk, survRM2, clinfun, jsonlite (or base fallback below).
# Run: Rscript tests/fixtures/oncology-reference.R > tests/fixtures/oncology-reference.json
suppressMessages({ library(survival); library(cmprsk); library(survRM2); library(clinfun) })
toj <- function(x) {
  if (is.null(x)) return("null")
  if (is.list(x)) {
    nm <- names(x)
    if (!is.null(nm) && all(nzchar(nm))) return(paste0("{", paste0('"', nm, '":', sapply(x, toj), collapse = ","), "}"))
    return(paste0("[", paste(sapply(x, toj), collapse = ","), "]"))
  }
  if (is.character(x)) { v <- paste0('"', x, '"') } else { v <- ifelse(is.na(x), "null", formatC(x, digits = 15, format = "g")) }
  if (length(x) == 1) v else paste0("[", paste(v, collapse = ","), "]")
}
out <- list()

# --- Cox PH on the NCCTG lung cancer data (complete cases) ---
d <- na.omit(lung[, c("time", "status", "age", "sex", "ph.ecog")])
d$status <- d$status - 1
out$lung <- list(time = d$time, status = d$status, age = d$age, sex = d$sex, ecog = d$ph.ecog)
for (ties in c("efron", "breslow")) {
  f <- coxph(Surv(time, status) ~ age + sex + ph.ecog, data = d, ties = ties)
  s <- summary(f)
  z <- cox.zph(f, transform = "km")
  out[[paste0("cox_", ties)]] <- list(coef = unname(coef(f)), se = unname(sqrt(diag(vcov(f)))),
    loglik = unname(f$loglik), lr = unname(s$logtest[1]), wald = unname(s$waldtest[1]), score = unname(s$sctest[1]),
    concordance = unname(f$concordance["concordance"]),
    zph_chisq = unname(z$table[, "chisq"]), zph_p = unname(z$table[, "p"]))
}
fs <- coxph(Surv(time, status) ~ age + ph.ecog + strata(sex), data = d)
out$cox_strata <- list(coef = unname(coef(fs)), se = unname(sqrt(diag(vcov(fs)))))

# --- RMST (survRM2) by sex, tau = 365 days ---
r <- rmst2(d$time, d$status, arm = d$sex - 1, tau = 365)
out$rmst <- list(tau = 365, arm0 = unname(r$RMST.arm0$rmst[1:2]), arm1 = unname(r$RMST.arm1$rmst[1:2]),
  diff = unname(r$unadjusted.result[1, 1:4]), ratio = unname(r$unadjusted.result[2, 1:4]))

# --- Competing risks: deterministic synthetic data ---
set.seed(42)
n <- 200
grp <- rep(c("A", "B", "C"), length.out = n)
t1 <- rexp(n, ifelse(grp == "A", 0.10, ifelse(grp == "B", 0.15, 0.07)))
t2 <- rexp(n, 0.06)
cens <- runif(n, 2, 25)
tt <- round(pmin(t1, t2, cens), 1)
st <- ifelse(tt == round(cens, 1) & cens <= pmin(t1, t2), 0, ifelse(t1 <= t2, 1, 2))
out$cr <- list(time = tt, status = st, group = grp)
ci <- cuminc(tt, st, grp)
tp <- timepoints(ci, c(2, 5, 10, 15))
out$cr_cif_A1 <- list(times = c(2, 5, 10, 15), est = unname(tp$est["A 1", ]), var = unname(tp$var["A 1", ]))
out$cr_gray <- list(stat = unname(ci$Tests[, "stat"]), p = unname(ci$Tests[, "pv"]), df = unname(ci$Tests[, "df"]))
cio <- cuminc(tt, st)
tpo <- timepoints(cio, c(3, 8, 12))
out$cr_cif_all <- list(times = c(3, 8, 12), est1 = unname(tpo$est[1, ]), var1 = unname(tpo$var[1, ]), est2 = unname(tpo$est[2, ]), var2 = unname(tpo$var[2, ]))

# --- Simon two-stage (clinfun) ---
simon <- function(p0, p1, a, b) {
  x <- ph2simon(p0, p1, a, b, nmax = 100)
  o <- x$out[which.min(x$out[, "EN(p0)"]), ]; m <- x$out[1, ]
  list(p0 = p0, p1 = p1, alpha = a, beta = b,
       optimal = unname(o[c("r1", "n1", "r", "n", "EN(p0)", "PET(p0)")]), minimax = unname(m[c("r1", "n1", "r", "n", "EN(p0)", "PET(p0)")]))
}
out$simon <- list(simon(0.1, 0.3, 0.05, 0.2), simon(0.2, 0.4, 0.05, 0.2), simon(0.05, 0.25, 0.1, 0.1), simon(0.3, 0.5, 0.05, 0.1))

# --- Exact binomial intervals ---
out$binom <- lapply(list(c(0, 20), c(7, 25), c(13, 40), c(30, 30)), function(v) { b <- binom.test(v[1], v[2]); c(v, unname(b$conf.int)) })

cat(toj(out), "\n")
