# Reference values for tests/ml.test.mjs (R side). Run from the repo root:
#   Rscript tests/fixtures/ml-reference.R && python3 tests/fixtures/ml-reference.py
# Writes tests/fixtures/ml-reference-r.json; the Python script merges it into ml-reference.json.
# Packages: glmnet (>= 5.0), pROC, survival, jsonlite.
suppressPackageStartupMessages({ library(glmnet); library(pROC); library(survival); library(jsonlite) })
set.seed(20261023)
n <- 200; p <- 8
X <- matrix(round(rnorm(n * p), 4), n, p)
X[, 3] <- round(X[, 3] * 3 + 2, 4)          # different scales exercise standardisation
lp <- 0.9 * X[, 1] - 0.6 * X[, 2] + 0.25 * X[, 3] - 0.5
y <- rbinom(n, 1, plogis(lp))
haz <- 0.08 * exp(0.7 * X[, 1] - 0.5 * X[, 4] + 0.1 * X[, 3])
tev <- rexp(n, haz); cens <- runif(n, 2, 20)
time <- round(pmin(tev, cens), 3); status <- as.integer(tev <= cens)
out <- list(X = X, y = y, time = time, status = status)
lam <- c(0.08, 0.03, 0.01)
for (a in c(1, 0.5)) {
  fb <- glmnet(X, y, family = "binomial", alpha = a, lambda = lam, control = list(thresh = 1e-14, maxit = 1e6))
  fc <- glmnet(X, Surv(time, status), family = "cox", alpha = a, lambda = lam / 2, cox.ties = "breslow", control = list(thresh = 1e-14, maxit = 1e6))
  pb <- glmnet(X, y, family = "binomial", alpha = a, nlambda = 5)
  pc <- glmnet(X, Surv(time, status), family = "cox", alpha = a, nlambda = 5, cox.ties = "breslow")
  out[[paste0("binomial_a", a)]] <- list(lambda = lam, a0 = unname(fb$a0), beta = unname(as.matrix(fb$beta)), lambdaMax = pb$lambda[1])
  out[[paste0("cox_a", a)]] <- list(lambda = lam / 2, beta = unname(as.matrix(fc$beta)), lambdaMax = pc$lambda[1])
}
# AUC + DeLong on a fixed score with ties
score <- round(lp + rnorm(n, sd = 1), 1)
r <- roc(y, score, quiet = TRUE, direction = "<", levels = c(0, 1))
ci <- ci.auc(r, method = "delong")
out$auc <- list(score = score, auc = as.numeric(auc(r)), lower = ci[1], upper = ci[3], var = var(r, method = "delong"))
# calibration intercept (offset) and slope
pr <- plogis(0.8 * lp + 0.3)
out$calib <- list(prob = pr,
  intercept = unname(coef(glm(y ~ offset(qlogis(pr)), family = binomial, control = glm.control(epsilon = 1e-14, maxit = 100)))[1]),
  slope = unname(coef(glm(y ~ qlogis(pr), family = binomial, control = glm.control(epsilon = 1e-14, maxit = 100)))[2]))
# Harrell's C for a Cox fit (survival::concordance)
fit <- coxph(Surv(time, status) ~ X[, 1] + X[, 4])
out$conc <- list(risk = unname(predict(fit, type = "lp")), c = unname(concordance(fit)$concordance))
writeLines(toJSON(out, digits = NA, matrix = "rowmajor", auto_unbox = TRUE), "tests/fixtures/ml-reference-r.json")
